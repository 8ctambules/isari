'use strict'

const { Router } = require('express')
const { ClientError, ServerError } = require('../lib/errors')
const es = require('../lib/elasticsearch')
const { restHandler } = require('../lib/rest-utils')

module.exports = Router()
.get('/', restHandler(listPeople))
.get('/:id', restHandler(getPeople))
.put('/:id', restHandler(updatePeople))
.post('/', restHandler(createPeople))
.delete('/:id', restHandler(deletePeople))
.get('/search', restHandler(searchPeople))


function listPeople () {
	throw new ServerError({ status: 501, title: 'TODO' })
}

function getPeople () {
	throw new ServerError({ status: 501, title: 'TODO' })
}

function updatePeople () {
	throw new ServerError({ status: 501, title: 'TODO' })
}

function createPeople () {
	throw new ServerError({ status: 501, title: 'TODO' })
}

function deletePeople () {
	throw new ServerError({ status: 501, title: 'TODO' })
}

function searchPeople (req) {
	const query = req.query.q
	const fields = req.query.fields ? req.query.fields.split(',') : undefined

	if (!query) {
		throw new ClientError({ title: 'Missing query string (field "q")' })
	}

	// return es.q('books', { query, fields })
	throw new ServerError({ status: 501, title: 'TODO' })
}