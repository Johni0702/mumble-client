import { EventEmitter } from 'events'
import DropStream from 'drop-stream'
import removeValue from 'remove-value'
import Timer from 'rtimer'

class User extends EventEmitter {
  constructor (client, id) {
    super()
    this._client = client
    this._id = id
    this._haveRequestedTexture = false
    this._haveRequestedComment = false
  }

  _update (msg) {
    var changes = {}
    if (msg.name != null) {
      changes.username = this._username = msg.name
    }
    if (msg.user_id != null) {
      changes.uniqueId = this._uniqueId = msg.user_id
    }
    if (msg.mute != null) {
      changes.mute = this._mute = msg.mute
    }
    if (msg.deaf != null) {
      changes.deaf = this._deaf = msg.deaf
    }
    if (msg.suppress != null) {
      changes.suppress = this._suppress = msg.suppress
    }
    if (msg.self_mute != null) {
      changes.selfMute = this._selfMute = msg.self_mute
    }
    if (msg.self_deaf != null) {
      changes.selfDeaf = this._selfDeaf = msg.self_deaf
    }
    if (msg.texture != null) {
      changes.texture = this._texture = msg.texture
    }
    if (msg.texture_hash != null) {
      changes.textureHash = this._textureHash = msg.texture_hash
      this._haveRequestedTexture = false // invalidate previous request
    }
    if (msg.comment != null) {
      changes.comment = this._comment = msg.comment
    }
    if (msg.comment_hash != null) {
      changes.commentHash = this._commentHash = msg.comment_hash
      this._haveRequestedComment = false // invalidate previous request
    }
    if (msg.priority_speaker != null) {
      changes.prioritySpeaker = this._prioritySpeaker = msg.priority_speaker
    }
    if (msg.recording != null) {
      changes.recording = this._recording = msg.recording
    }
    if (msg.hash != null) {
      changes.certHash = this._certHash = msg.hash
    }
    if (msg.channel_id != null) {
      if (this.channel) {
        removeValue(this.channel.users, this)
      }
      this._channelId = msg.channel_id
      if (this.channel) {
        this.channel.users.push(this)
      }
      changes.channel = this.channel
    }
    this.emit('update', this._client._userById[msg.actor], changes)
  }

  _remove (actor, reason, ban) {
    if (this.channel) {
      removeValue(this.channel.users, this)
    }
    this.emit('remove', actor, reason, ban)
  }

  _getOrCreateVoiceStream () {
    if (!this._voice) {
      // New transmission
      if (!this._client._codecs) {
        // No codecs available, cannot decode
        this._voice = DropStream.obj()
      } else {
        this._voice = this._client._codecs.createDecoderStream(this)
      }
      this._voice.once('close', () => {
        this._voice = null
      })
      this._voiceTimeout = new Timer(() => {
        if (this._voice != null) {
          this._voice.end()
          this._voice = null
        }
      }, this._client._options.userVoiceTimeout || 200).set()
      this.emit('voice', this._voice)
    }
    return this._voice
  }

  _getDuration (codec, frames) {
    if (this._client._codecs) {
      let duration = 0
      frames.forEach(frame => {
        duration += this._client._codecs.getDuration(codec, frame)
      })
      return duration
    } else {
      return frames.length * 10
    }
  }

  /**
   * This method filters and inserts empty frames as needed to accout
   * for packet loss and then writes to the {@link #_voice} stream.
   * If this is a new transmission it emits the 'voice' event and if
   * the transmission has ended it closes the stream.
   */
  _onVoice (seqNum, codec, target, frames, position, end) {
    if (frames.length > 0) {
      let duration = this._getDuration(codec, frames)
      if (this._voice != null) {
        // This is not the first packet in this transmission

        // So drop it if it's late
        if (this._lastVoiceSeqId > seqNum) {
          return
        }

        // And make up for lost packets
        if (this._lastVoiceSeqId < seqNum - duration / 10) {
          let lost = seqNum - this._lastVoiceSeqId - 1
          // Cap at 10 lost frames, the audio will sound broken at that point anyway
          if (lost > 10) {
            lost = 10
          }
          for (let i = 0; i < lost; i++) {
            this._getOrCreateVoiceStream().write({
              target: target,
              codec: codec,
              frame: null,
              position: position
            })
          }
        }
      }
      frames.forEach(frame => {
        this._getOrCreateVoiceStream().write({
          target: target,
          codec: codec,
          frame: frame,
          position: position
        })
      })
      this._voiceTimeout.set()
      this._lastVoiceSeqId = seqNum + duration / 10 - 1
    }
    if (end && this._voice) {
      this._voiceTimeout.clear()
      this._voiceTimeout = null
      this._voice.end()
      this._voice = null
    }
  }

  setMute (mute) {
    var message = {
      name: 'UserState',
      payload: {
        session: this._id,
        mute: mute
      }
    }
    if (!mute) message.payload.deaf = false
    this._client._send(message)
  }

  setDeaf (deaf) {
    var message = {
      name: 'UserState',
      payload: {
        session: this._id,
        deaf: deaf
      }
    }
    if (deaf) message.payload.mute = true
    this._client._send(message)
  }

  clearComment () {
    this._client._send({
      name: 'UserState',
      payload: {
        session: this._id,
        comment: ''
      }
    })
  }

  clearTexture () {
    this._client._send({
      name: 'UserState',
      payload: {
        session: this._id,
        texture: ''
      }
    })
  }

  requestComment () {
    if (this._haveRequestedComment) return
    this._client._send({
      name: 'RequestBlob',
      payload: {
        session_comment: this._id
      }
    })
    this._haveRequestedComment = true
  }

  requestTexture () {
    if (this._haveRequestedTexture) return
    this._client._send({
      name: 'RequestBlob',
      payload: {
        session_texture: this._id
      }
    })
    this._haveRequestedTexture = true
  }

  register () {
    this._client._send({
      name: 'UserState',
      payload: {
        session: this._id,
        user_id: 0
      }
    })
  }

  sendMessage (message) {
    this._client._send({
      name: 'TextMessage',
      payload: {
        session: this._id,
        message: message
      }
    })
  }

  setChannel (channel) {
    this._client._send({
      name: 'UserState',
      payload: {
        session: this._id,
        channel_id: channel._id
      }
    })
  }

  get id () {
    return this._id
  }

  get username () {
    return this._username
  }

  set username (to) {
    throw new Error('Cannot set username.')
  }

  get uniqueId () {
    return this._uniqueId
  }

  set uniqueId (to) {
    throw new Error('Cannot set uniqueId. Maybe try #register()?')
  }

  get mute () {
    return this._mute
  }

  set mute (to) {
    throw new Error('Cannot set mute. Use #setMute(mute) instead.')
  }

  get deaf () {
    return this._deaf
  }

  set deaf (to) {
    throw new Error('Cannot set deaf. Use #setDeaf(deaf) instead.')
  }

  get selfMute () {
    return this._selfMute
  }

  set selfMute (to) {
    throw new Error('Cannot set selfMute. Use Client#setSelfMute(mute) instead.')
  }

  get selfDeaf () {
    return this._selfDeaf
  }

  set selfDeaf (to) {
    throw new Error('Cannot set selfDeaf. Use Client#setSelfDeaf(deaf) instead.')
  }

  get suppress () {
    return this._suppress
  }

  set suppress (to) {
    throw new Error('Cannot set suppress.')
  }

  get texture () {
    return this._texture
  }

  set texture (to) {
    throw new Error('Cannot set texture. Use Client#setSelfTexture(texture) or #clearTexture() instead.')
  }

  get textureHash () {
    return this._textureHash
  }

  set textureHash (to) {
    throw new Error('Cannot set textureHash.')
  }

  get comment () {
    return this._comment
  }

  set comment (to) {
    throw new Error('Cannot set comment. Use Client#setSelfTexture(texture) or #clearComment() instead.')
  }

  get commentHash () {
    return this._commentHash
  }

  set commentHash (to) {
    throw new Error('Cannot set commentHash.')
  }

  get prioritySpeaker () {
    return this._prioritySpeaker
  }

  set prioritySpeaker (to) {
    throw new Error('Cannot set prioritySpeaker. Use #setPrioritySpeaker(prioSpeaker) instead.')
  }

  get recording () {
    return this._recording
  }

  set recording (to) {
    throw new Error('Cannot set recording. Use Client#setSelfRecording(recording) instead.')
  }

  get certHash () {
    return this._certHash
  }

  set certHash (to) {
    throw new Error('Cannot set certHash.')
  }

  get channel () {
    if (this._channelId != null) {
      return this._client._channelById[this._channelId]
    } else {
      return null
    }
  }

  set channel (to) {
    throw new Error('Cannot set channel. Use #setChannel(channel) instead.')
  }
}

export default User
