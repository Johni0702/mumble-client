/* eslint-env mocha */
/* eslint-disable no-unused-expressions */
import { expect } from 'chai'
import { fail } from 'assert'
import { PassThrough } from 'stream'
import User from '../lib/user'

describe('User', function () {
  this.timeout(100)
  let client
  let user
  let channel1, channel2
  beforeEach(function () {
    channel1 = { _id: 1, users: [] }
    channel2 = { _id: 2, users: [] }
    client = {
      _channelById: { 1: channel1, 2: channel2 },
      _userById: {},
      _options: {}
    }
    user = new User(client, 31)
  })
  const simpleProperties = [
    ['username', 'name', 'Test'],
    ['uniqueId', 'user_id', 123],
    ['mute', 'mute', true],
    ['deaf', 'deaf', true],
    ['selfMute', 'self_mute', true],
    ['selfDeaf', 'self_deaf', true],
    ['suppress', 'suppress', true],
    ['texture', 'texture', '123'],
    ['textureHash', 'texture_hash', '123'],
    ['comment', 'comment', '123'],
    ['commentHash', 'comment_hash', '123'],
    ['prioritySpeaker', 'priority_speaker', true],
    ['recording', 'recording', true],
    ['certHash', 'hash', '123']
  ]
  describe('changing of property', function () {
    simpleProperties.forEach(property => {
      it('should prevent ' + property[0], function () {
        expect(() => {
          user[property[0]] = property[2]
        }).to.throw(/Cannot set .+/)
      })
    })
    it('should prevent channel', function () {
      expect(() => {
        user.channel = null
      }).to.throw(/Cannot set .+/)
    })
  })
  describe('parsing a UserState message', function () {
    let theActor
    beforeEach(() => {
      theActor = {}
      client._userById[42] = theActor
    })
    simpleProperties.forEach(property => {
      it('should update ' + property[0], function (done) {
        user.once('update', (actor, properties) => {
          expect(actor).to.equal(theActor)
          expect(properties).to.deep.equal({ [property[0]]: property[2] })
          expect(user[property[0]]).to.equal(property[2])
          done()
        })
        user._update({ actor: 42, [property[1]]: property[2] })
      })
    })
    it('should update the channel', function (done) {
      user.once('update', (actor, properties) => {
        expect(actor).to.equal(theActor)
        expect(properties).to.deep.equal({ channel: channel1 })
        expect(user.channel).to.equal(channel1)
        expect(channel1.users).to.have.members([user])
        expect(channel2.users).to.be.empty

        user.once('update', (actor, properties) => {
          expect(actor).to.equal(theActor)
          expect(properties).to.deep.equal({ channel: channel2 })
          expect(user.channel).to.equal(channel2)
          expect(channel1.users).to.be.empty
          expect(channel2.users).to.have.members([user])
          done()
        })
        user._update({ actor: 42, channel_id: 2 })
      })
      user._update({ actor: 42, channel_id: 1 })
    })
    it('should handle a message without an actor', function (done) {
      user.once('update', (actor, properties) => {
        expect(properties).to.deep.equal({
          username: 'Name'
        })
        done()
      })
      user._update({ name: 'Name' })
    })
  })
  describe('#setMute(mute)', function () {
    it('should send UserState message', function (done) {
      client._send = function (msg) {
        expect(msg).to.deep.equal({
          name: 'UserState',
          payload: { session: 31, mute: true }
        })
        done()
      }
      user.setMute(true)
    })
    it('should also undeaf when unmuting', function (done) {
      client._send = function (msg) {
        expect(msg).to.deep.equal({
          name: 'UserState',
          payload: { session: 31, mute: false, deaf: false }
        })
        done()
      }
      user.setMute(false)
    })
  })
  describe('#setDeaf(deaf)', function () {
    it('should send UserState message', function (done) {
      client._send = function (msg) {
        expect(msg).to.deep.equal({
          name: 'UserState',
          payload: { session: 31, deaf: false }
        })
        done()
      }
      user.setDeaf(false)
    })
    it('should also mute when deafing', function (done) {
      client._send = function (msg) {
        expect(msg).to.deep.equal({
          name: 'UserState',
          payload: { session: 31, mute: true, deaf: true }
        })
        done()
      }
      user.setDeaf(true)
    })
  })
  describe('#clearComment()', function () {
    it('should send UserState message', function (done) {
      client._send = function (msg) {
        expect(msg).to.deep.equal({
          name: 'UserState',
          payload: { session: 31, comment: '' }
        })
        done()
      }
      user.clearComment()
    })
  })
  describe('#clearTexture()', function () {
    it('should send UserState message', function (done) {
      client._send = function (msg) {
        expect(msg).to.deep.equal({
          name: 'UserState',
          payload: { session: 31, texture: '' }
        })
        done()
      }
      user.clearTexture()
    })
  })
  describe('#register()', function () {
    it('should send UserState message', function (done) {
      client._send = function (msg) {
        expect(msg).to.deep.equal({
          name: 'UserState',
          payload: { session: 31, user_id: 0 }
        })
        done()
      }
      user.register()
    })
  })
  describe('#channel', function () {
    it('should lazily return the parent channel', function () {
      user._update({ channel_id: 1 })
      expect(user.channel).to.equal(channel1)
      const newChannel1 = { _id: 1, new: true }
      client._channelById[1] = newChannel1
      expect(user.channel).to.equal(newChannel1)
    })
  })
  describe('#_remove(actor, reason, ban)', function () {
    it('should unregister from its channel', function () {
      user._update({ channel_id: 1 })
      expect(channel1.users).to.have.members([user])
      user._remove(null, '', false)
      expect(channel1.users).to.be.empty
    })
    it('should emit remove event', function (done) {
      const theActor = {}
      user.once('remove', function (actor, reason, ban) {
        expect(actor).to.equal(theActor)
        expect(reason).to.equal('Reason')
        expect(ban).to.be.true
        done()
      })
      user._remove(theActor, 'Reason', true)
    })
  })
  describe('#sendMessage(message)', function () {
    it('should send TextMessage message', function (done) {
      client._send = function (msg) {
        expect(msg).to.deep.equal({
          name: 'TextMessage',
          payload: {
            session: 31,
            message: 'Test'
          }
        })
        done()
      }
      user.sendMessage('Test')
    })
  })
  describe('#sendMessage(message)', function () {
    it('should send UserState message', function (done) {
      const channel = { _id: 42 }
      client._send = function (msg) {
        expect(msg).to.deep.equal({
          name: 'UserState',
          payload: {
            session: 31,
            channel_id: 42
          }
        })
        done()
      }
      user.setChannel(channel)
    })
  })
  describe('#_onVoice(seqNum, codec, target, frames, position, end)', function () {
    beforeEach(function () {
      user._client._codecs = {
        createDecoderStream (chunk) {
          return new PassThrough({ objectMode: true })
        },
        getDuration (codec, buffer) {
          return 10
        }
      }
    })
    // it('should emit voice event with stream', function () {
    //   var frame = Buffer.of(1, 2, 3, 4)
    //   var thePosition = {}
    //   var voiceEvent = false
    //   user.once('voice', stream => {
    //     stream.once('data', d => {
    //       expect(d.target).to.equal('normal')
    //       expect(d.codec).to.equal('Opus')
    //       expect(d.frame).to.equal(frame)
    //       expect(d.position).to.equal(thePosition)
    //       voiceEvent = true
    //       stream.once('data', () => fail('duplicate data event'))
    //     }).on('close', () => fail('unexpected end event'))
    //     user.once('voice', () => fail('duplicate voice event'))
    //   })
    //   user._onVoice(0, 'Opus', 'normal', [frame], thePosition, false)
    //   expect(voiceEvent, 'voice event called').to.be.true
    // })
    it('should close stream when no voice for 100ms', function (done) {
      this.timeout(100)
      user._client._options.userVoiceTimeout = 20
      const frame = Buffer.of(1, 2, 3, 4)
      const thePosition = {}
      let voiceEvents = 0
      user.once('voice', stream => {
        stream
          .on('data', d => {
            expect(d.target).to.equal('normal')
            expect(d.codec).to.equal('Opus')
            expect(d.frame).to.equal(frame)
            expect(d.position).to.equal(thePosition)
            voiceEvents++
          })
          .once('end', () => {
            expect(voiceEvents).to.equal(3)
            done()
          })
      })
      user._onVoice(0, 'Opus', 'normal', [frame], thePosition, false)
      setTimeout(() => {
        user._onVoice(0, 'Opus', 'normal', [frame], thePosition, false)
      }, 15)
      setTimeout(() => {
        user._onVoice(0, 'Opus', 'normal', [frame], thePosition, false)
      }, 30)
      /* setTimeout(() => fail('stream not closed after 30ms of silence'), 60) */
    })
    it('should end current transmission if the stream is closed', function (done) {
      const frame1 = Buffer.of(1, 2)
      const frame2 = Buffer.of(3, 4)
      user.once('voice', stream => {
        stream.once('data', d => {
          expect(d.frame).to.equal(frame1)
          stream.emit('close')
          stream.once('data', () => fail('stream used after close'))
          user.once('voice', newStream => {
            expect(newStream).to.not.equal(stream)
            newStream.on('data', d => {
              expect(d.frame).to.equal(frame2)
              done()
            })
          })
        })
      })
      user._onVoice(0, 'Opus', 'normal', [frame1], null, true)
      user._onVoice(1, 'Opus', 'normal', [frame2], null, true)
    })
    it('should drop old voice packets', function () {
      let voiceEvent = false
      const frame1 = Buffer.of(1, 2)
      const frame2 = Buffer.of(3, 4)
      user.once('voice', stream => {
        stream.once('data', d => {
          expect(d.frame).to.equal(frame1)
          stream.once('data', () => fail('packet not dropped'))
          voiceEvent = true
        })
      })
      user._onVoice(1, 'Opus', 'normal', [frame1], null, false)
      user._onVoice(0, 'Opus', 'normal', [frame2], null, false)
      expect(voiceEvent).to.be.true
    })
    it('should send empty frames for lost voice packets', function () {
      const actualFrames = []
      const frame1 = Buffer.of(1, 2)
      const frame2 = Buffer.of(3, 4)
      const frame3 = Buffer.of(5, 6)
      user.once('voice', stream => {
        stream.on('data', d => {
          actualFrames.push(d.frame)
        })
      })
      user._onVoice(0, 'Opus', 'normal', [frame1], null, false)
      user._onVoice(5, 'Opus', 'normal', [frame2, frame2], null, false)
      user._onVoice(8, 'Opus', 'normal', [frame3], null, false)
      expect(actualFrames).to.deep.equal([
        frame1,
        null,
        null,
        null,
        null,
        frame2,
        frame2,
        null,
        frame3
      ])
    })
    it('should drop audio when no codecs are available', function (done) {
      client._codecs = null
      const frame1 = Buffer.of(1, 2)
      const frame2 = Buffer.of(3, 4)
      const frame3 = Buffer.of(5, 6)
      let voiceEvent = false
      user.once('voice', stream => {
        stream
          .on('data', d => {
            fail('data passed through')
          })
          .on('end', done)
        voiceEvent = true
      })
      user._onVoice(0, 'Opus', 'normal', [frame1], null, false)
      user._onVoice(5, 'Opus', 'normal', [frame2, frame2], null, false)
      user._onVoice(8, 'Opus', 'normal', [frame3], null, true)
      expect(voiceEvent).to.be.true
    })
  })
})
