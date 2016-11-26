/* eslint-env mocha */
import { expect } from 'chai'
import { fail } from 'assert'
import { Duplex } from 'stream'
import Client from '..'
import Channel from '../lib/channel'
import User from '../lib/user'
import { data, version } from 'mumble-streams'
const DenyType = data.messages.PermissionDenied.DenyType

describe('Client', function () {
  this.timeout(100)
  var client
  beforeEach(function () {
    client = new Client({
      username: 'Test',
      password: 'Password',
      tokens: ['token1', 'token2'],
      clientSoftware: 'Test Release',
      osName: 'Test OS',
      osVersion: 'v123'
    })
    client.self = {
      _id: 42
    }
  })
  describe('#connectDataStream(stream)', function () {
    it('should throw an error when the called multiple times', function () {
      client._send = () => {}
      client.connectDataStream(new Duplex())
      expect(() => {
        client.connectDataStream(new Duplex())
      }).to.throw(Error)
    })
    it('should send Version and Authenticate messages', function (done) {
      client._send = function (msg) {
        expect(msg).to.deep.equal({
          name: 'Version',
          payload: {
            version: version.toUInt8(),
            release: 'Test Release',
            os: 'Test OS',
            os_version: 'v123'
          }
        })

        client._send = function (msg) {
          expect(msg).to.deep.equal({
            name: 'Authenticate',
            payload: {
              username: 'Test',
              password: 'Password',
              tokens: ['token1', 'token2'],
              celt_versions: [],
              opus: false
            }
          })
          done()
        }
      }
      client.connectDataStream(new Duplex())
    })
  })
  describe('#_onData(msg)', function () {
    it('should handle initial ChannelState message', function (done) {
      client.once('newChannel', function (channel) {
        expect(channel).to.be.an.instanceof(Channel)
        expect(client.channels).to.have.members([channel])
        expect(client._channelById).to.have.property(42, channel)
        channel.once('update', function () {
          expect(channel.name).to.equal('Test')
          done()
        })
      })
      client._onData({
        name: 'ChannelState',
        payload: {
          channel_id: 42,
          name: 'Test'
        }
      })
    })
    it('should forward ChannelState message payload', function (done) {
      var channel = {
        _update: function (msg) {
          expect(msg).to.have.property('name', 'New Name')
          done()
        }
      }
      client.channels.push(channel)
      client._channelById[42] = channel
      client._onData({
        name: 'ChannelState',
        payload: {
          channel_id: 42,
          name: 'New Name'
        }
      })
    })
    it('should handle ChannelRemove message', function () {
      var removedCalled = false
      var channel = {
        _id: 42,
        _remove: function () {
          if (removedCalled) {
            fail('channel._remove called more than once')
          } else {
            removedCalled = true
          }
        }
      }
      client.channels.push(channel)
      client._channelById[42] = channel
      client._onData({
        name: 'ChannelRemove',
        payload: {
          channel_id: 42
        }
      })
      expect(removedCalled).to.be.true
      expect(client.channels).to.be.empty
      expect(client._channelById).to.not.have.property(42)
    })
    it('should handle initial UserState message', function (done) {
      client.once('newUser', function (user) {
        expect(user).to.be.an.instanceof(User)
        expect(client.users).to.have.members([user])
        expect(client._userById).to.have.property(42, user)
        user.once('update', function () {
          expect(user.username).to.equal('Test')
          done()
        })
      })
      client._onData({
        name: 'UserState',
        payload: {
          session: 42,
          name: 'Test'
        }
      })
    })
    it('should add default channel to initial UserState message', function (done) {
      var channel = {
        users: [],
        _update: function (msg) {
          expect(msg).to.have.property('name', 'New Name')
          done()
        }
      }
      client.channels.push(channel)
      client._channelById[0] = channel
      client.once('newUser', function (user) {
        user.once('update', function () {
          expect(user.channel).to.equal(channel)
          done()
        })
      })
      client._onData({
        name: 'UserState',
        payload: {
          session: 42
        }
      })
    })
    it('should forward UserState message payload', function (done) {
      var user = {
        _update: function (msg) {
          expect(msg).to.have.property('name', 'New Name')
          done()
        }
      }
      client.users.push(user)
      client._userById[42] = user
      client._onData({
        name: 'UserState',
        payload: {
          session: 42,
          name: 'New Name'
        }
      })
    })
    it('should handle UserRemove message', function () {
      var removedCalled = false
      var user = {
        _id: 42,
        _remove: function (actor, reason, ban) {
          if (removedCalled) {
            fail('channel._remove called more than once')
          } else {
            removedCalled = true
          }
        }
      }
      client.users.push(user)
      client._userById[42] = user

      var theActor = {}
      client.users.push(theActor)
      client._userById[1] = theActor

      client._onData({
        name: 'UserRemove',
        payload: {
          session: 42,
          actor: 1,
          reason: 'Reason',
          ban: true
        }
      })
      expect(removedCalled).to.be.true
      expect(client.users).to.have.members([theActor])
      expect(client._userById).to.not.have.property(42)
    })
    it('should handle ServerSync message', function (done) {
      var self = {}
      client.users.push(self)
      client._userById[42] = self

      client.on('connected', function () {
        expect(client.self).to.equal(self)
        expect(client.maxBandwidth).to.equal(123)
        expect(client.welcomeMessage).to.equal('Welcome!')
        done()
      })
      client._onData({
        name: 'ServerSync',
        payload: {
          session: 42,
          max_bandwidth: 123,
          welcome_text: 'Welcome!',
          permissions: 0 // TODO here and above
        }
      })
    })
    it('should handle UDPTunnel', function (done) {
      var payload = {}
      client._voiceDecoder = {
        write (data) {
          expect(data).to.equal(payload)
          done()
        }
      }
      client._onData({
        name: 'UDPTunnel',
        payload: payload
      })
    })
    // TODO BanList
    it('should handle TextMessage', function (done) {
      var user = {}
      client.users.push(user)
      client._userById[42] = user

      var channel1 = {}
      client.channels.push(channel1)
      client._channelById[1] = channel1
      var channel2 = {}
      client.channels.push(channel2)
      client._channelById[2] = channel2

      client.on('message', function (sender, message, targetUsers, targetChannels, targetTrees) {
        expect(sender).to.equal(user)
        expect(message).to.equal('Test')
        expect(targetUsers).to.have.members([user])
        expect(targetChannels).to.have.members([channel1])
        expect(targetTrees).to.have.members([channel2])
        done()
      })
      client._onData({
        name: 'TextMessage',
        payload: {
          actor: 42,
          message: 'Test',
          session: [42],
          channel_id: [1],
          tree_id: [2]
        }
      })
    })
    describe('PermissionDenied', function () {
      var user = {}
      var channel = {}
      var types = [
        [ 'Text', null, null, 'Reason', { reason: 'Reason' } ],
        [ 'Permission', user, channel, 'perm', { session: 1, channel_id: 1, permission: 'perm' } ],
        [ 'SuperUser', null, null, null, {} ],
        [ 'ChannelName', null, null, 'Name', { name: 'Name' } ],
        [ 'TextTooLong', null, null, null, {} ],
        [ 'TemporaryChannel', null, null, null, {} ],
        [ 'MissingCertificate', user, null, null, { session: 1 } ],
        [ 'UserName', null, null, 'Name', { name: 'Name' } ],
        [ 'ChannelFull', null, null, null, {} ],
        [ 'NestingLimit', null, null, null, {} ]
      ]
      types.forEach(function (data) {
        var [theType, theUser, theChannel, theDetail, payload] = data
        it('should handle type ' + theType, function (done) {
          client._userById[1] = user
          client._channelById[1] = channel

          client.once('denied', function (type, user, channel, detail) {
            expect(type).to.equal(theType)
            expect(user).to.equal(theUser)
            expect(channel).to.equal(theChannel)
            expect(detail).to.equal(theDetail)
            done()
          })

          payload.type = DenyType[theType]
          client._onData({
            name: 'PermissionDenied',
            payload: payload
          })
        })
      })
    })
    // TODO ACL
    // TODO QueryUsers
    // TODO CryptSetup
    // TODO ContextActionModify
    // TODO ContextAction
    // TODO UserList
    // TODO VoiceTarget
    // TODO PermissionQuery
    // TODO CodecVersion
    // TODO UserStats
    // TODO ServerConfig
    // TODO SuggestConfig
  })
  describe('#setSelfMute(mute)', function () {
    it('should send UserState message', function (done) {
      client._send = function (msg) {
        expect(msg).to.deep.equal({
          name: 'UserState',
          payload: {
            session: 42,
            self_mute: true
          }
        })
        done()
      }
      client.setSelfMute(true)
    })
    it('should also undeaf when unmuting', function (done) {
      client._send = function (msg) {
        expect(msg).to.deep.equal({
          name: 'UserState',
          payload: {
            session: 42,
            self_mute: false,
            self_deaf: false
          }
        })
        done()
      }
      client.setSelfMute(false)
    })
  })
  describe('#setSelfDeaf(deaf)', function () {
    it('should send UserState message', function (done) {
      client._send = function (msg) {
        expect(msg).to.deep.equal({
          name: 'UserState',
          payload: {
            session: 42,
            self_deaf: false
          }
        })
        done()
      }
      client.setSelfDeaf(false)
    })
    it('should also mute when deafing', function (done) {
      client._send = function (msg) {
        expect(msg).to.deep.equal({
          name: 'UserState',
          payload: {
            session: 42,
            self_mute: true,
            self_deaf: true
          }
        })
        done()
      }
      client.setSelfDeaf(true)
    })
  })
  describe('#setSelfTexture(texture)', function () {
    it('should send UserState message', function (done) {
      var texture = Buffer.of(0, 1, 2, 3)
      client._send = function (msg) {
        expect(msg).to.deep.equal({
          name: 'UserState',
          payload: {
            session: 42,
            texture: texture
          }
        })
        done()
      }
      client.setSelfTexture(texture)
    })
  })
  describe('#setSelfComment(description)', function () {
    it('should send UserState message', function (done) {
      client._send = function (msg) {
        expect(msg).to.deep.equal({
          name: 'UserState',
          payload: {
            session: 42,
            comment: 'Comment'
          }
        })
        done()
      }
      client.setSelfComment('Comment')
    })
  })
  describe('#setPluginContext(context)', function () {
    it('should send UserState message', function (done) {
      var context = Buffer.of(0, 1, 2, 3)
      client._send = function (msg) {
        expect(msg).to.deep.equal({
          name: 'UserState',
          payload: {
            session: 42,
            plugin_context: context
          }
        })
        done()
      }
      client.setPluginContext(context)
    })
  })
  describe('#setPluginIdentity(identity)', function () {
    it('should send UserState message', function (done) {
      client._send = function (msg) {
        expect(msg).to.deep.equal({
          name: 'UserState',
          payload: {
            session: 42,
            plugin_identity: 'Test'
          }
        })
        done()
      }
      client.setPluginIdentity('Test')
    })
  })
  describe('#setRecording(recording)', function () {
    it('should send UserState message', function (done) {
      client._send = function (msg) {
        expect(msg).to.deep.equal({
          name: 'UserState',
          payload: {
            session: 42,
            recording: true
          }
        })
        done()
      }
      client.setRecording(true)
    })
  })
  describe('voice packet decoded', function () {
    it('should forward the voice data to the user', function (done) {
      var theFrame = {}
      var thePosition = {}
      var user = {
        _onVoice (seqNum, codec, target, frames, position, end) {
          expect(seqNum).to.equal(13)
          expect(codec).to.equal('Opus')
          expect(target).to.equal('normal')
          expect(frames).to.have.members([theFrame])
          expect(position).to.equal(thePosition)
          expect(end).to.be.true
          done()
        }
      }
      client._userById[31] = user
      client.users.push(user)
      client._voice.emit('data', {
        seqNum: 13,
        codec: 'Opus',
        source: 31,
        target: 'normal',
        frames: [theFrame],
        position: thePosition,
        end: true
      })
    })
  })
})
