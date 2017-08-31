'use strict'

const { Router } = require('express')
const { UnauthorizedError } = require('../lib/errors')
const {EditLog} = require('../lib/edit-logs')
const { requiresAuthentication } = require('../lib/permissions')
const models = require('../lib/model')
const {fillIncompleteDate} = require('../export/helpers')


const mongoose = require('mongoose')
const _ = require('lodash')

const async = require('async')
const debug = require('debug')('isari:export')

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
	const keep = path[0] !== 'latestChangeBy' && // internal field
				!(path.length > 2 && path[0] === 'academicMemberships' && path [2] === 'organization') &&
				!path.includes('id') // weird diff for foreign keys
	return keep
}

const editLogsDataKeysBlacklist = ['_id', 'latestChangeBy']




module.exports = Router().get('/:model', requiresAuthentication, getEditLog)

function getEditLog(req, res){
	let model = req.params.model
	// params
	const itemID = req.query.itemID
	const query = req.query

	// User has to be central admin to access editLog list feature
	if (!itemID && req.userCentralRole !== 'admin'){
		res.send(UnauthorizedError({ title: 'EditLog is restricted to central admin users'}))
	}

	// User has to have write access on an object to access its editlog
	if(
			(model === 'people' && itemID && !req.userCanEditPeople(itemID)) ||
			(model === 'activity' && itemID && !req.userCanEditActivity(itemID)) ||
			(model === 'organization' && itemID && !req.userCanEditOrganization(itemID))
	){
		res.send(UnauthorizedError({ title: 'Write access is mandatory to access EditLog'}))
	}



	async.waterfall([
		next => {
			if (!query.whoID && (query.isariLab || query.isariRole)){
				//need to retrieve list of targeted creators first
				const mongoQueryPeople = {}
				if (query.isariLab)
					mongoQueryPeople['isariAuthorizedCenters.organization'] = ObjectId(query.isariLab)
				if (query.isariRole)
					mongoQueryPeople['isariAuthorizedCenters.isariRole'] = query.isariRole

				models.People.aggregate([
					{$match:mongoQueryPeople},
					{$project:{_id:1}}
				]).then(whoIds => next(null, whoIds.map(r => r._id)))
			}
			else{
				next(null, undefined)
			}
		},
		(whoIds, next) =>{
			// build the mongo query to editLog collection
			model = _.capitalize(model)
			const mongoQuery = {model}
			if (itemID)
				mongoQuery.item = ObjectId(itemID)

			if (query.whoID)
				mongoQuery['whoID'] = query.whoID
			else 
				if (whoIds)
					mongoQuery['whoID'] = {$in:whoIds} 
			
			if (query.path)
				mongoQuery['diff'] = {'$elemMatch': {'0.path':query.path}} 
			
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
			const aggregationPipeline = [
				{'$match':mongoQuery},
				{'$lookup':{
					from: 'people',
					localField: 'whoID',
					foreignField: '_id',
					as: 'creator'
				}},
				{'$lookup':{
					from: model === 'People' ? 'people' : (model === 'Organization' ? 'organizations' : 'activities'),
					localField: 'item',
					foreignField: '_id',
					as: 'itemObject'
				}},
				// TODO : project to only usefull fields to limit payload
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
			debug('count?')
			debug(query.count)
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
				aggregationPipeline.push({'$skip':query.skip})
			if (!query.count && query.limit)
				aggregationPipeline.push({'$limit':query.limit})

			EditLog.aggregate(aggregationPipeline)
			.then(data => {
				if (query.count)
					return next(null, data[0])

				const edits = []
				data.forEach(d => {
					const edit = {}
					edit.who = {
						id: d.whoID,
						name: (d.creator[0].firstName ? d.creator[0].firstName+' ': '')+ d.creator[0].name,
						roles: d.creator[0].isariAuthorizedCenters ? 
										d.creator[0].isariAuthorizedCenters.map(iac =>({lab:iac.organization,role:iac.isariRole})):
										[]
					}

					edit.date = d.date
					edit.item = { id:d.item}
					if (model === 'People' && d.itemObject[0]){
						edit.item.name = (d.itemObject[0].firstName ? d.itemObject[0].firstName+' ': '')+ d.itemObject[0].name
					}else
							if (d.itemObject[0])
								edit.item.name = d.itemObject[0].acronym || d.itemObject[0].name

					edit.action = d.action

					if (edit.action === 'update'){
						edit.diff = d.diff.filter(dd => editLogsPathFilter(dd[0].path))
																			// blaclisting weird diffs
												.map(dd => {
													dd = dd[0]

													// remove index of element in array from path
													const diff = {path: dd.path.filter(e => typeof e !== 'number')}

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

					if (edit.diff.length === 0){
						debug('empty diff in :')
						debug(edit)
					}
					else
						edits.push(edit)
				})      
				next(null,edits)
			})
		}
	],
		(error,edits) =>{
			if (error) res.status(500).send(error) 
			return res.status(200).send(edits)
		}
	)
}
