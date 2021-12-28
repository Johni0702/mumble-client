/* eslint-env mocha */
/* eslint-disable no-unused-expressions */
import { expect } from 'chai'
import Channel from '../lib/channel'

describe('Channel', function () {
  this.timeout(100)
  let channel1, channel2, channel3, channel4
  let client
  let channel
  beforeEach(function () {
    channel1 = { _id: 1, children: [] }
    channel2 = { _id: 2, children: [] }
    channel3 = { _id: 3, children: [] }
    channel4 = { _id: 4, children: [] }
    client = {
      _channelById: { 1: channel1, 2: channel2, 3: channel3, 4: channel4 }
    }
    channel = new Channel(client, 31)
  })
  it('should have users array', function () {
    expect(channel.users).be.an.instanceof(Array)
  })
  it('should have children array', function () {
    expect(channel.children).be.an.instanceof(Array)
  })
  const simpleProperties = [
    ['name', 'name', '123'],
    ['description', 'description', '123'],
    ['descriptionHash', 'description_hash', '123'],
    ['temporary', 'temporary', true],
    ['position', 'position', 123],
    ['maxUsers', 'max_users', 123]
  ]
  describe('changing of property', function () {
    simpleProperties.forEach(property => {
      it('should prevent ' + property[0], function () {
        expect(() => {
          channel[property[0]] = property[2]
        }).to.throw(Error)
      })
      it('should prevent parent', function () {
        expect(() => {
          channel.parent = channel2
        }).to.throw(Error)
      })
      it('should prevent links', function () {
        expect(() => {
          channel.links = []
        }).to.throw(Error)
      })
    })
  })
  describe('#update(messagePayload)', function () {
    simpleProperties.forEach(property => {
      it('should update ' + property[0], function (done) {
        channel.once('update', properties => {
          expect(properties).to.deep.equal({ [property[0]]: property[2] })
          expect(channel[property[0]]).to.equal(property[2])
          done()
        })
        channel._update({ [property[1]]: property[2] })
      })
    })
    it('should update the parent channel', function (done) {
      channel.once('update', properties => {
        expect(properties).to.deep.equal({ parent: channel3 })
        expect(channel.parent).to.equal(channel3)
        expect(channel3.children).to.deep.equal([channel])

        channel.once('update', properties => {
          expect(properties).to.deep.equal({ parent: channel2 })
          expect(channel.parent).to.equal(channel2)
          expect(channel3.children).to.be.empty
          expect(channel2.children).to.deep.equal([channel])
          done()
        })
        channel._update({ parent: 2 })
      })
      channel._update({ parent: 3 })
    })
    it('should update the links', function (done) {
      channel.once('update', properties => {
        expect(properties).to.deep.equal({
          links: [channel1, channel2, channel3, channel4]
        })
        expect(channel.links).to.deep.equal([
          channel1,
          channel2,
          channel3,
          channel4
        ])
        done()
      })
      channel._update({ links: [1, 2, 3, 4] })
    })
    it('should add links', function (done) {
      channel.once('update', properties => {
        expect(properties).to.deep.equal({ links: [channel1, channel2] })
        expect(channel.links).to.deep.equal([channel1, channel2])

        channel.once('update', properties => {
          expect(properties).to.deep.equal({
            links: [channel1, channel2, channel3, channel4]
          })
          expect(channel.links).to.deep.equal([
            channel1,
            channel2,
            channel3,
            channel4
          ])
          done()
        })
        channel._update({ links_add: [3, 4] })
      })
      channel._update({ links_add: [1, 2] })
    })
    it('should remove links', function (done) {
      channel.once('update', properties => {
        expect(properties).to.deep.equal({
          links: [channel1, channel2, channel3]
        })
        expect(channel.links).to.deep.equal([channel1, channel2, channel3])

        channel.once('update', properties => {
          expect(properties).to.deep.equal({ links: [channel1] })
          expect(channel.links).to.deep.equal([channel1])
          done()
        })
        channel._update({ links_remove: [2, 3] })
      })
      channel._update({ links: [1, 2, 3] })
    })
  })
  describe('#setParent(parentChannel)', function () {
    it('should send UserState message', function (done) {
      client._send = function (msg) {
        expect(msg).to.deep.equal({
          name: 'ChannelState',
          payload: { channel_id: 31, parent: 3 }
        })
        done()
      }
      channel.setParent(channel3)
    })
  })
  describe('#setName(name)', function () {
    it('should send UserState message', function (done) {
      client._send = function (msg) {
        expect(msg).to.deep.equal({
          name: 'ChannelState',
          payload: { channel_id: 31, name: '123' }
        })
        done()
      }
      channel.setName('123')
    })
  })
  describe('#setDescription(description)', function () {
    it('should send UserState message', function (done) {
      client._send = function (msg) {
        expect(msg).to.deep.equal({
          name: 'ChannelState',
          payload: { channel_id: 31, description: '123' }
        })
        done()
      }
      channel.setDescription('123')
    })
  })
  describe('#setTemporary(temporary)', function () {
    it('should send UserState message', function (done) {
      client._send = function (msg) {
        expect(msg).to.deep.equal({
          name: 'ChannelState',
          payload: { channel_id: 31, temporary: true }
        })
        done()
      }
      channel.setTemporary(true)
    })
  })
  describe('#setPosition(position)', function () {
    it('should send UserState message', function (done) {
      client._send = function (msg) {
        expect(msg).to.deep.equal({
          name: 'ChannelState',
          payload: { channel_id: 31, position: 3 }
        })
        done()
      }
      channel.setPosition(3)
    })
  })
  describe('#setLinks(linkedChannels)', function () {
    it('should send UserState message', function (done) {
      client._send = function (msg) {
        expect(msg).to.deep.equal({
          name: 'ChannelState',
          payload: { channel_id: 31, links: [1, 2] }
        })
        done()
      }
      channel.setLinks([channel1, channel2])
    })
  })
  describe('#setMaxUsers(maxUsers)', function () {
    it('should send UserState message', function (done) {
      client._send = function (msg) {
        expect(msg).to.deep.equal({
          name: 'ChannelState',
          payload: { channel_id: 31, max_users: 3 }
        })
        done()
      }
      channel.setMaxUsers(3)
    })
  })
  describe('#parent', function () {
    it('should lazily return the parent channel', function () {
      channel._update({ parent: 1 })
      expect(channel.parent).to.equal(channel1)
      const newChannel1 = { _id: 1, new: true }
      client._channelById[1] = newChannel1
      expect(channel.parent).to.equal(newChannel1)
    })
  })
  describe('#_remove()', function () {
    it('should unregister from its parent', function () {
      channel._update({ parent: 1 })
      expect(channel1.children).to.have.members([channel])
      channel._remove()
      expect(channel1.children).to.be.empty
    })
    it('should emit remove event', function (done) {
      channel.once('remove', function () {
        done()
      })
      channel._remove()
    })
  })
  describe('#sendMessage(message)', function () {
    it('should send TextMessage message', function (done) {
      client._send = function (msg) {
        expect(msg).to.deep.equal({
          name: 'TextMessage',
          payload: {
            channel_id: [31],
            message: 'Test'
          }
        })
        done()
      }
      channel.sendMessage('Test')
    })
  })
  describe('#sendTreeMessage(message)', function () {
    it('should send TextMessage message', function (done) {
      client._send = function (msg) {
        expect(msg).to.deep.equal({
          name: 'TextMessage',
          payload: {
            tree_id: [31],
            message: 'Test'
          }
        })
        done()
      }
      channel.sendTreeMessage('Test')
    })
  })
})
