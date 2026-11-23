import test from 'node:test'
import assert from 'node:assert/strict'
import mongoose from 'mongoose'
import http from 'node:http'
import dotenv from 'dotenv'
import { serve, stub, query } from './helpers/http.js'
import Property from '../src/models/Property.js'
import Blog from '../src/models/Blog.js'
import ViewingRequest from '../src/models/ViewingRequest.js'
import Contact from '../src/models/Contact.js'
import SavedSearch from '../src/models/SavedSearch.js'

test('app import has no database, listener or dotenv side effects; public HTTP routes remain open', async t => {
  stub(t, mongoose, 'connect', () => { throw new Error('Unexpected Mongo connection') })
  stub(t, http.Server.prototype, 'listen', () => { throw new Error('Unexpected listener') })
  stub(t, dotenv, 'config', () => { throw new Error('Unexpected dotenv load') })
  const { default: app } = await import('../src/app.js')
  assert.equal(typeof app, 'function')
})

test('root and public browse/contact/viewing use real HTTP with model mocks', async t => {
  const { default: app } = await import('../src/app.js')
  stub(t, Property, 'find', () => query([]))
  stub(t, Blog, 'find', () => query([]))
  stub(t, Property, 'findById', () => query({ _id: 'listing' }))
  stub(t, Blog, 'findById', () => query({ _id: 'post' }))
  stub(t, ViewingRequest, 'create', async data => ({ ...data, _id: 'viewing' }))
  stub(t, Contact, 'create', async data => data)
  stub(t, SavedSearch, 'find', () => query([]))
  stub(t, SavedSearch, 'findById', () => query(null))
  stub(t, SavedSearch, 'findByIdAndUpdate', () => query({_id:'search'}))
  const api = await serve(app)
  t.after(api.close)
  assert.deepEqual(await api.request('GET', '/'), { status: 200, data: 'Zawamu Properties API is running' })
  for (const path of ['/api/properties', '/api/properties/listing', '/api/blog', '/api/blog/post']) {
    assert.equal((await api.request('GET', path)).status, 200, path)
  }
  assert.equal((await api.request('POST', '/api/contact', null, {name:'Visitor',email:'visitor@example.test',message:'Hello'})).status, 201)
  assert.equal((await api.request('POST', '/api/viewing-requests', null, {propertyId:'listing',name:'Visitor'})).status, 201)
  assert.equal((await api.request('POST', '/api/auth/register')).status, 404)
  // Saved-search management requires a separate verified email session.
  assert.equal((await api.request('POST', '/api/saved-searches')).status,400)
  assert.equal((await api.request('GET', '/api/saved-searches/user/visitor@example.test')).status,401)
  assert.equal((await api.request('GET', '/api/saved-searches/search')).status,401)
  assert.equal((await api.request('GET', '/api/saved-searches/search/properties')).status,401)
  assert.equal((await api.request('PUT', '/api/saved-searches/search')).status,401)
  assert.equal((await api.request('DELETE', '/api/saved-searches/search')).status,401)
  assert.equal(mongoose.connection.readyState, 0)
})
