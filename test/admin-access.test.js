import test from 'node:test'
import assert from 'node:assert/strict'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import User from '../src/models/User.js'
import Property from '../src/models/Property.js'
import Blog from '../src/models/Blog.js'
import Contact from '../src/models/Contact.js'
import ViewingRequest from '../src/models/ViewingRequest.js'
import { serve, stub, query } from './helpers/http.js'

const endpoints = [
  ['POST','/api/properties',201], ['PUT','/api/properties/item',200], ['DELETE','/api/properties/item',200],
  ['GET','/api/admin/stats',200], ['GET','/api/admin/recent-activity',200],
  ['GET','/api/viewing-requests',200], ['GET','/api/viewing-requests/item',200],
  ['PUT','/api/viewing-requests/item',200], ['DELETE','/api/viewing-requests/item',200],
  ['POST','/api/upload',400], ['POST','/api/blog',201], ['PUT','/api/blog/item',200],
  ['DELETE','/api/blog/item',200], ['GET','/api/analytics',200], ['GET','/api/saved-searches/admin/check-matches',200],
]

async function setup(t) {
  const previous = { JWT_SECRET: process.env.JWT_SECRET, ADMIN_EMAILS: process.env.ADMIN_EMAILS }
  process.env.JWT_SECRET = 'local-test-secret-not-for-deployment'
  process.env.ADMIN_EMAILS = ' other@example.test, OWNER@Example.Test , , '
  t.after(() => { for (const [key,value] of Object.entries(previous)) value === undefined ? delete process.env[key] : process.env[key] = value })
  let actor = { _id:'actor', name:'Actor', email:'ordinary@example.test', password:'private', internal:'never expose' }
  const propertyFixture = {
    _id: '64b000000000000000000003',
    title: 'Test home',
    description: 'A valid mocked property fixture',
    price: 100000,
    location: 'Nairobi',
    type: 'Apartment',
    bedrooms: 2,
    bathrooms: 1,
    area: 800,
    featured: false,
    images: [],
    features: ['Pool'],
  }
  stub(t, User, 'findById', id => {
    assert.equal(id, 'actor')
    if (actor instanceof Error) throw actor
    return query(actor)
  })
  for (const model of [Property, Blog, Contact, ViewingRequest]) {
    stub(t, model, 'find', () => query([]))
    stub(t, model, 'countDocuments', async () => 0)
    stub(t, model, 'findById', () => query({_id:'item'}))
    stub(t, model, 'create', async body => ({_id:'item', ...body}))
    stub(t, model, 'findByIdAndUpdate', async () => ({_id:'item'}))
    stub(t, model, 'findByIdAndDelete', async () => ({_id:'item'}))
  }
  stub(t, Property, 'findById', () => query(propertyFixture))
  stub(t, Property.prototype, 'save', async function () { return this })
  const { default: app } = await import('../src/app.js')
  const api = await serve(app)
  t.after(api.close)
  return { ...api, actor: value => {actor=value}, token: claims => jwt.sign({userId:'actor',...claims},process.env.JWT_SECRET) }
}

test('every owner endpoint rejects anonymous and ordinary identities, and permits persisted owner into real handlers', async t => {
  const api = await setup(t)
  for (const [method,path,success] of endpoints) {
    await t.test(`${method} ${path}`, async () => {
      api.actor({_id:'actor',email:'ordinary@example.test'})
      assert.equal((await api.request(method,path)).status,401)
      assert.equal((await api.request(method,path,api.token({isAdmin:true,email:'owner@example.test'}))).status,403)
      api.actor({_id:'actor',email:' owner@example.test '})
      const body = method === 'POST' && path === '/api/properties'
        ? { title: 'Owner listing', description: 'A valid test fixture', price: 100000, location: 'Nairobi', type: 'Apartment' }
        : method === 'PUT' && path === '/api/properties/item'
          ? { description: 'Updated test fixture' }
          : {}
      assert.equal((await api.request(method,path,api.token({}),body)).status,success)
    })
  }
})

test('upload rejects unauthorized malformed multipart before multer parses it', async t => {
  const api = await setup(t)
  const contentType = 'multipart/form-data; boundary=deliberately-broken'
  for (const token of [undefined, api.token({isAdmin:true})]) {
    const response = await api.request('POST','/api/upload',token,'malformed body',contentType)
    assert.equal(response.status,token ? 403 : 401)
  }
})

test('allowlist and current persisted identity fail closed', async t => {
  const api = await setup(t)
  const token = api.token({isAdmin:true,email:'owner@example.test'})
  for (const email of ['notowner@example.test','owner@example.test.evil','',null]) {
    api.actor({_id:'actor',email})
    assert.equal((await api.request('GET','/api/analytics',token)).status,403)
  }
  api.actor({_id:'actor',email:'owner@example.test'})
  for (const config of [undefined,'',' ,  , ']) {
    config === undefined ? delete process.env.ADMIN_EMAILS : process.env.ADMIN_EMAILS=config
    assert.equal((await api.request('GET','/api/analytics',token)).status,403)
  }
  process.env.ADMIN_EMAILS='owner@example.test'
  api.actor({_id:'actor',email:'OwNeR@eXaMpLe.TeSt'})
  assert.equal((await api.request('GET','/api/analytics',token)).status,200)
  api.actor(null)
  assert.equal((await api.request('GET','/api/analytics',token)).status,403)
  api.actor(new Error('sensitive database failure'))
  assert.deepEqual(await api.request('GET','/api/analytics',token),{status:500,data:{message:'Unable to verify owner access'}})
  for (const claims of [{}, {userId:null}, {userId:{}}, {userId:''}]) {
    const malformed = jwt.sign(claims,process.env.JWT_SECRET)
    assert.equal((await api.request('GET','/api/analytics',malformed)).status,401)
  }
})

test('real bcrypt login and profile return explicit capability DTO only', async t => {
  const api = await setup(t)
  const password = await bcrypt.hash('test-password', 4)
  let stored
  stub(t, User, 'findOne', () => query(stored))
  for (const [email,isAdmin] of [['owner@example.test',true],['ordinary@example.test',false]]) {
    stored = {_id:'actor',name:'Actor',email,password,__v:9,internal:'private',isAdmin:!isAdmin}
    api.actor(stored)
    const login = await api.request('POST','/api/auth/login',null,{email,password:'test-password',isAdmin:true})
    assert.equal(login.status,200)
    const expected={id:'actor',name:'Actor',email,isAdmin}
    assert.deepEqual(login.data.user,expected)
    assert.equal(jwt.verify(login.data.token,process.env.JWT_SECRET).userId,'actor')
    assert.deepEqual(await api.request('GET','/api/auth/profile',login.data.token),{status:200,data:expected})
    assert.equal((await api.request('POST','/api/auth/login',null,{email,password:'wrong'})).status,401)
  }
})
