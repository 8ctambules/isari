'use strict'

const { Router } = require('express')
const { UnauthorizedError, NotFoundError, ServerError } = require('../lib/errors')
const { EditLog, flattenDiff } = require('../lib/edit-logs')
const { requiresAuthentication, scopeOrganizationMiddleware } = require('../lib/permissions')
const models = require('../lib/model')
const { fillIncompleteDate } = require('../export/helpers')
const { getAccessMonitoringPaths, computeConfidentialPaths } = require('../lib/schemas')
const config = require('config')


const mongoose = require('mongoose')
const _ = require('lodash')

const debug = require('debug')('isari:EditLog')

const ObjectId = mongoose.Types.ObjectId

// UTILS

function formatKind(kind){
// edit logs object kind attribute formatting
	if (kind === 'E')
		return 'update'
	if (kind === 'D')
		return 'delete'
	if (kind === 'N')
		return 'create'
	//by default fall back to update
	return 'update'
}

function editLogsPathFilter(path){
	// blacklisting weird diff generated by edtiLogs middleware or internal fields
	// This filtering should be done in mongo direclty to avoid problems with pagination
	// Turning those filter in mongo might be possible with $filter
	// This doesn't work :
	//  $filter:{
	//    input:'$diff',
	//    as:'d',
	//    cond:{$not:{$and:[
	//        {'$$d.path.3':{$exists: true}},
	//        {'$$d.path.0':'academicMemberships'},
	//        {'$$d.path.2':'organization'}
	//        ]}}
	// }
	return path[0] !== 'latestChangeBy'
}


const editLogsDataKeysBlacklist = ['_id', 'latestChangeBy']




module.exports = Router().get('/:model', requiresAuthentication, scopeOrganizationMiddleware, getEditLog)

const routeParamToModel = param => ({
	activities: 'Activity',
	organizations: 'Organization',
	people: 'People',
}[param])

function getEditLog(req, res){
	const model = routeParamToModel(req.params.model)
	const itemID = req.query.itemID
	const query = req.query

	const validParamsP = Promise.resolve()
		// Check validity of model param
		.then(() => {
			if (!model) {
				throw new NotFoundError({ title: 'Invalid model' })
			}
		})
		// User has to be central admin to access editLog list feature
		.then(() => {
			if (!itemID && req.userCentralRole !== 'admin'){
				throw new UnauthorizedError({ title: 'EditLog is restricted to central admin users'})
			}
		})
		// User has to have write access on an object to access its editlog
		.then(() => {
			if (itemID) {
				return req['userCanEdit' + model](itemID).then(ok => {
					if (!ok) {
						throw new UnauthorizedError({ title: 'Write access is mandatory to access EditLog'})
					}
				})
			}
		})

	const whoIdsItemIdsP = validParamsP
		.then(() => {
			if (!query.whoID && (query.isariLab || query.isariRole)){
				//need to retrieve list of targeted creators first
				const mongoQueryPeople = {}
				if (query.isariLab)
					mongoQueryPeople['isariAuthorizedCenters.organization'] = ObjectId(query.isariLab)
				if (query.isariRole)
					mongoQueryPeople['isariAuthorizedCenters.isariRole'] = query.isariRole

				return models.People.aggregate([
					{$match:mongoQueryPeople},
					{$project:{_id:1}}
				]).then(whos => whos.map(r => r._id))
			} else {
				return undefined
			}
		})
		.then(whoIds => {
			//prepare Item filter organisation scope mongoQuery
			//focusing on one item, scope has been checked earlier
			if (query.itemID)
				return {whoIds, itemIds: ObjectId(query.itemID)}
			// scope doesn't apply on organizations
			if (model === 'Organization')
				return {whoIds}
			// scope on people => start/end on academicMemberships
			if (model === 'People'){
				let options = {}
				if (query.startDate || query.endDate){
					options = {includeRange:true,membershipStart:query.startDate,membershipEnd:query.endDate, includeExternals:false, includeMembers:false}
				}
				else
					options = {includeMembers:true, includeRange:false, includeExternals:false}

				return req.userListViewablePeople(options).then(ids => {
					debug(ids.query.getQuery())
					return {whoIds, itemIds: ids.query.getQuery()._id}
				})

			}
			// scope on activities => start/end on activity + organizations
			if (model === 'Activity'){
				let options = {}
				if (query.startDate || query.endDate){
					options = {range:true,startDate:query.startDate,endDate:query.endDate}
				}
				else
					options = {range:false}

				return req.userListViewableActivities(options).then(mongoquery => {
					if (query.startDate || query.endDate)
						return {whoIds, itemIds: mongoquery.query.getQuery()['organizations.organization']}
					else
						mongoquery.query.then(activities => {
							return {whoIds, itemIds: {$in: activities.map(a => a._id)}}
						})
				})
			}
		})

	// Mainly for debugging purpose, you can force confidential fields filtering
	// by adding ?noConfidential=1
	const canViewConfidentialP = query.noConfidential
		? Promise.resolve(false)
		: req.userCanViewConfidentialFields()

	const editsP = Promise.all([
		whoIdsItemIdsP,
		canViewConfidentialP,
	])
		.then(([whoIdsItemIds, canViewConfidential]) => {
			// build the mongo query to editLog collection
			const mongoQuery = {model}
			if (whoIdsItemIds.itemIds)
				mongoQuery.item = whoIdsItemIds.itemIds

			if (query.whoID)
				mongoQuery['whoID'] = ObjectId(query.whoID)
			else
				if (whoIdsItemIds.whoIds)
					mongoQuery['whoID'] = {$in: whoIdsItemIds.whoIds}

			if (query.path || query.accessMonitoring) {
				const paths1 = query.accessMonitoring ? getAccessMonitoringPaths(model, query.accessMonitoring) : []
				const paths2 = query.path ? [query.path] : []
				const paths = paths1.concat(paths2)
				debug({paths})
				if (paths.length > 0){
					if (query.action === 'create' || query.action === 'delete') {
						mongoQuery['$or'] = paths.map(path => ({ ['data.' + path]: {$exists: true} }))
					} else {
						mongoQuery['diff'] = {'$elemMatch': {'$or': paths.map(path=>({path})) }}
					}
				}
				else
					// accessMonitoring filter on but no fields in schema => return  nothing
					return res.status(200).send([])
			}

			if (query.action)
				mongoQuery['action'] = query.action

			//dates
			if (query.startDate)
				mongoQuery['date'] = {'$gte': new Date(fillIncompleteDate(query.startDate, true))}

			if (query.endDate){
				const endDate = new Date(fillIncompleteDate(query.endDate, false))
				endDate.setHours(23)
				endDate.setMinutes(59)
				if (mongoQuery['date'])
					mongoQuery['date']['$lte'] = endDate
				else
					mongoQuery['date']= {'$lte': endDate}
			}
			debug('Query', mongoQuery)
			let aggregationPipeline = [
				{'$match':mongoQuery},
				{'$lookup':{
					from: 'people',
					localField: 'whoID',
					foreignField: '_id',
					as: 'creator'
				}},
				{'$lookup':{
					from: config.collections[model],
					localField: 'item',
					foreignField: '_id',
					as: 'itemObject'
				}},
				{'$project':{
					whoID:1,
					date:1,
					item:1,
					diff:1,
					data:1,
					action:1,
					'itemObject.name':1,
					'itemObject.firstName':1,
					'itemObject.acronym':1,
					'creator.firstName':1,
					'creator.name':1,
					'creator.isariAuthorizedCenters':1
				}},
				{'$sort':{date:-1}}
			]

			//count
			if (query.count)
				aggregationPipeline.push({
					'$group': {
						'_id' : null,
						'count' : {$sum : 1}
					}
				})

			// skip and limit
			if (!query.count && query.skip)
				aggregationPipeline.push({'$skip':+query.skip})
			if (!query.count && query.limit)
				aggregationPipeline.push({'$limit':+query.limit})

			return EditLog.aggregate(aggregationPipeline)
				.then(data => query.count ? data[0] : formatEdits(data, model, !canViewConfidential))
		})

	return editsP
		.then(edits => res.status(200).send(edits))
		.catch(err => {
			if (!err.status) {
				err = new ServerError({ title: err.message })
			}
			res.status(err.status).send(err)
		})
}

function formatItemName(data, model){
	if (model === 'People' && data) {
		return (data.firstName ? data.firstName+' ': '')+ data.name
	} else if (data) {
		return data.acronym || data.name
	} else {
		return undefined
	}
}

function formatEdits(data, model, removeConfidential){
	const edits = []
	data.forEach(d => {
		const edit = {}
		edit.who = {
			id: d.whoID
		}
		if (d.creator.length){
			edit.who.name = (d.creator[0].firstName ? d.creator[0].firstName+' ': '')+ d.creator[0].name
			edit.who.roles = d.creator[0].isariAuthorizedCenters ?
							d.creator[0].isariAuthorizedCenters.map(iac =>({lab:iac.organization,role:iac.isariRole})):
							[]
		}

		edit.date = d.date
		edit.item = { id:d.item}
		edit.item.name = formatItemName(d.itemObject[0], model)

		edit.action = d.action



		if (edit.action === 'update'){
			edit.diff = flattenDiff(d.diff)
									.filter(dd => editLogsPathFilter(dd.path))
									.map(dd => {
										// remove index of element in array from path
										const diff = {path: dd.path.filter(e => isNaN(parseInt(e)))}

										if (dd.kind === 'A'){
											//array case...
											if (dd.item.lhs)
												diff.valueBefore = dd.item.lhs
											if(dd.item.rhs)
												diff.valueAfter = dd.item.rhs
											diff.editType = formatKind(dd.item.kind)
										}
										else {
											if (dd.lhs)
												diff.valueBefore = dd.lhs
											if( dd.rhs)
												diff.valueAfter = dd.rhs
											diff.editType = formatKind(dd.kind)
										}
										return diff
									})
		}
		else{
			edit.diff = []
			// in case of create or delete diff data is stored in data
			if (!edit.item.name)
				edit.item.name = formatItemName(d.data, model)
			_.forOwn(d.data, (value,key) => {
				// we filter tecnical fields
				if (!editLogsDataKeysBlacklist.includes(key)){
					const diff = {
						editType: d.action,
						path: [key]
					}
					// store in value After or Before as other diffs
					diff[d.action === 'create' ? 'valueAfter' : 'valueBefore'] = value
					edit.diff.push(diff)
				}
			})
		}


		if (removeConfidential) {
			edit.diff = edit.diff.filter(isNotConfidentialChange(model))
		}

		edit.diff = getAccessMonitorings(model, edit.diff)

		// if (edit.diff.length === 0){
		// 	debug('empty diff in :')
		// 	debug(edit)
		// }
		// else
		edits.push(edit)
	})
	debug(edits)
	return edits
}

const getAccessMonitorings = (model, formattedDiff) => {

	let paths = []
	if (model === 'organizations')
		paths = getAccessMonitoringPaths('organization')
	else
		if (model === 'activities')
			paths = getAccessMonitoringPaths('activity')
		else
			paths = getAccessMonitoringPaths(model)

	return formattedDiff.map(change => Object.assign({},change,{
		accessMonitoring: paths[change.path[0]]

	}))
}

const isNotConfidentialChange = model => {
	const paths = computeConfidentialPaths(model)
		// Remove all '.*' from schema path, as collection indices won't appear in formatted change
		// Also add a final dot to compare proper paths and avoid confusion with field with same prefix
		.map(path => path.replace(/\.\*/g, '') + '.')
	return change => {
		const currPath = change.path.join('.') + '.'
		const isConfidential = paths.some(confidentialPath => {
			//console.log({confidentialPath, currPath, matches: currPath.startsWith(confidentialPath)})
			return currPath.startsWith(confidentialPath)
		})
		if (isConfidential) {
			debug('Filtered confidential change', change)
		}
		return !isConfidential
	}
}
