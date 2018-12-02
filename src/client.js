import mumbleStreams from 'mumble-streams'
import duplexer from 'reduplexer'
import { EventEmitter } from 'events'
import through2 from 'through2'
import Promise from 'promise'
import DropStream from 'drop-stream'
import { getOSName, getOSVersion } from './utils.js'
import User from './user'
import Channel from './channel'
import removeValue from 'remove-value'
import Stats from 'stats-incremental'

const DenyType = mumbleStreams.data.messages.PermissionDenied.DenyType

/*
 * @typedef {'Opus'} Codec
 */

/**
 * Number of the voice target when outgoing (0 for normal talking, 1-31 for
 * a voice target).
 * String describing the source when incoming.
 * @typedef {number|'normal'|'shout'|'whisper'} VoiceTarget
 */

/**
 * @typedef {object} VoiceData
 * @property {VoiceTarget} target - Target of the audio
 * @property {Codec} codec - The codec of the audio packet
 * @property {Buffer} frame - Encoded audio frame, null indicates a lost frame
 * @property {?Position} position - Position of audio source
 */

/**
 * Interleaved 32-bit float PCM frames in [-1; 1] range with sample rate of 48k.
 * @typedef {object} PCMData
 * @property {VoiceTarget} target - Target of the audio
 * @property {Float32Array} pcm - The pcm data
 * @property {number} numberOfChannels - Number of channels
 * @property {?Position} position - Position of audio source
 * @property {?number} bitrate - Target bitrate hint for encoder, see for default {@link MumbleClient#setAudioQuality}
 */

/**
 * Transforms {@link VoiceData} to {@link PCMData}.
 * Should ignore any unknown codecs.
 *
 * @interface DecoderStream
 * @extends stream.Transform
 */

/**
 * Transforms {@link PCMData} to {@link VoiceData}.
 *
 * @interface EncoderStream
 * @extends stream.Transform
 */

/**
 * @interface Codecs
 * @property {number[]} celt - List of celt versions supported by this implementation
 * @property {boolean} opus - Whether this implementation supports the Opus codec
 */

/**
 * Returns the duration of encoded voice data without actually decoding it.
 *
 * @function Codecs#getDuration
 * @param {Codec} codec - The codec
 * @param {Buffer} buffer - The encoded data
 * @return {number} The duration in milliseconds (has to be a multiple of 10)
 */

/**
 * Creates a new decoder stream for a transmission of the specified user.
 * This method is called for every single transmission (whenever a user starts
 * speaking), as such it must not be expensive.
 *
 * @function Codecs#createDecoderStream
 * @param {User} user - The user
 * @return {DecoderStream} The decoder stream
 */

/**
 * Creates a new encoder stream for a outgoing transmission.
 * This method is called for every single transmission (whenever the user
 * starts speaking), as such it must not be expensive.
 *
 * @function Codecs#createEncoderStream
 * @param {Codec} codec - The codec
 * @return {EncoderStream} The endecoder stream
 */

/**
 * Single use Mumble client.
 */
class MumbleClient extends EventEmitter {
  /**
   * A mumble client.
   * This object may only be connected to one server and cannot be reused.
   *
   * @param {object} options - Options
   * @param {string} options.username - User name of the client
   * @param {string} [options.password] - Server password to use
   * @param {string[]} [options.tokens] - Array of access tokens to use
   * @param {string} [options.clientSoftware] - Client software name/version
   * @param {string} [options.osName] - Client operating system name
   * @param {string} [options.osVersion] - Client operating system version
   * @param {Codecs} [options.codecs] - Codecs used for voice
   * @param {number} [options.userVoiceTimeout] - Milliseconds after which an
   *  inactive voice transmissions is timed out
   * @param {number} [options.maxInFlightDataPings] - Amount of data pings without response
   *  after which the connection is considered timed out
   * @param {number} [options.dataPingInterval] - Interval of data pings (in ms)
   * @param {object} [options.webrtc] - WebRTC options if the server supports it
   * @param {object} [options.webrtc.enabled] - Whether to enable WebRTC support
   * @param {object} [options.webrtc.required] - Failed connection if WebRTC unsupported by server
   * @param {object} [options.webrtc.mic] - MediaStream (or track) to use as local source of audio
   * @param {object} [options.webrtc.audioContext] - AudioContext to which remote nodes are connected
   */
  constructor (options) {
    super()

    if (!options.username) {
      throw new Error('No username given')
    }

    this._options = options || {}
    this._username = options.username
    this._password = options.password
    this._tokens = options.tokens
    this._codecs = options.codecs

    this._webrtcOptions = options.webrtc || {}
    this._webrtcSupported = this._webrtcOptions.enabled
    this._webrtcRequired = this._webrtcOptions.required
    this._webrtcMic = this._webrtcOptions.mic
    this._webrtcAudioCtx = this._webrtcOptions.audioContext
    if (this._webrtcSupported) {
      if (!this._webrtcMic || !this._webrtcAudioCtx) {
        throw Error('Need mic and audio context for WebRTC')
      }
      this._pc = new window.RTCPeerConnection()
      this._pc.addStream(this._webrtcMic)
      this._pc.onicecandidate = (event) => {
        if (event.candidate) {
          this._send({
            name: 'IceCandidate',
            payload: {
              content: event.candidate.candidate
            }
          })
        }
      }
      this._pc.ontrack = (event) => {
        let stream = new window.MediaStream()
        stream.addTrack(event.track)
        this._webrtcAudioCtx.createMediaStreamSource(stream)
          .connect(this._webrtcAudioCtx.destination)
      }
    }

    this._dataPingInterval = options.dataPingInterval || 5000
    this._maxInFlightDataPings = options.maxInFlightDataPings || 2
    this._dataStats = new Stats()
    this._voiceStats = new Stats()

    this._userById = {}
    this._channelById = {}

    this.users = []
    this.channels = []

    this._dataEncoder = new mumbleStreams.data.Encoder()
    this._dataDecoder = new mumbleStreams.data.Decoder()
    this._voiceEncoder = new mumbleStreams.voice.Encoder('server')
    this._voiceDecoder = new mumbleStreams.voice.Decoder('server')
    this._data = duplexer(this._dataEncoder, this._dataDecoder, {objectMode: true})
    this._voice = duplexer(this._voiceEncoder, this._voiceDecoder, {objectMode: true})

    this._data.on('data', this._onData.bind(this))
    this._voice.on('data', this._onVoice.bind(this))
    this._voiceEncoder.on('data', data => {
      // TODO This should only be the fallback option
      this._data.write({
        name: 'UDPTunnel',
        payload: data
      })
    })
    this._voiceDecoder.on('unknown_codec', codecId =>
      this.emit('unknown_codec', codecId))
    this._data.on('end', this.disconnect.bind(this))

    this._registerErrorHandler(this._data, this._voice, this._dataEncoder,
      this._dataDecoder, this._voiceEncoder, this._voiceDecoder)

    this._disconnected = false
  }

  _registerErrorHandler () {
    for (const obj of arguments) {
      obj.on('error', this._error.bind(this))
    }
  }

  _error (reason) {
    this.emit('error', reason)
    this.disconnect()
  }

  _send (msg) {
    this._data.write(msg)
  }

  /**
   * Connects this client to a duplex stream that is used for the data channel.
   * The provided duplex stream is expected to be valid and usable.
   * Calling this method will begin the initialization of the connection.
   *
   * @param stream - The stream used for the data channel.
   * @param callback - Optional callback that is invoked when the connection has been established.
   */
  connectDataStream (stream, callback) {
    if (this._dataStream) throw Error('Already connected!')
    this._dataStream = stream

    // Connect the supplied stream to the data channel encoder and decoder
    this._registerErrorHandler(stream)
    this._dataEncoder.pipe(stream).pipe(this._dataDecoder)

    // Send the initial two packets
    this._send({
      name: 'Version',
      payload: {
        version: mumbleStreams.version.toUInt8(),
        release: this._options.clientSoftware || 'Node.js mumble-client',
        os: this._options.osName || getOSName(),
        os_version: this._options.osVersion || getOSVersion()
      }
    })
    this._send({
      name: 'Authenticate',
      payload: {
        username: this._username,
        password: this._password,
        tokens: this._tokens,
        celt_versions: (this._codecs || { celt: [] }).celt,
        opus: (this._codecs || { opus: false }).opus,
        webrtc: this._webrtcSupported
      }
    })

    return new Promise((resolve, reject) => {
      this.once('connected', () => resolve(this))
      this.once('reject', reject)
      this.once('error', reject)
    }).nodeify(callback)
  }

  /**
   * Connects this client to a duplex stream that is used for the voice channel.
   * The provided duplex stream is expected to be valid and usable.
   * The stream may be unreliable. That is, it may lose packets or deliver them
   * out of order.
   * It must however gurantee that packets arrive unmodified and/or are dropped
   * when corrupted.
   * It is also responsible for any encryption that is necessary.
   *
   * Connecting a voice channel is entirely optional. If no voice channel
   * is connected, all voice data is tunneled through the data channel.
   *
   * @param stream - The stream used for the data channel.
   * @returns {undefined}
   */
  connectVoiceStream (stream) {
    // Connect the stream to the voice channel encoder and decoder
    this._registerErrorHandler(stream)
    this._voiceEncoder.pipe(stream).pipe(this._voiceDecoder)

    // TODO: Ping packet
  }

  createVoiceStream (target = 0, numberOfChannels = 1) {
    if (this._webrtcEnabled) {
      this._webrtcMic.getAudioTracks()[0].enabled = true
      this._send({
        name: 'TalkingState',
        payload: {
          target: target
        }
      })
      return DropStream.obj().on('finish', () => {
        this._webrtcMic.getAudioTracks()[0].enabled = false
        this._send({
          name: 'TalkingState',
          payload: {}
        })
      })
    }
    if (!this._codecs) {
      return DropStream.obj()
    }
    var voiceStream = through2.obj((chunk, encoding, callback) => {
      if (chunk instanceof Buffer) {
        chunk = new Float32Array(chunk.buffer, chunk.byteOffset, chunk.byteLength / 4)
      }
      if (chunk instanceof Float32Array) {
        chunk = {
          target: target,
          pcm: chunk,
          numberOfChannels: numberOfChannels
        }
      } else {
        chunk = {
          target: target,
          pcm: chunk.pcm,
          numberOfChannels: numberOfChannels,
          position: { x: chunk.x, y: chunk.y, z: chunk.z }
        }
      }
      let samples = this._samplesPerPacket || (chunk.pcm.length / numberOfChannels)
      chunk.bitrate = this.getActualBitrate(samples, chunk.position != null)
      callback(null, chunk)
    })
    const codec = 'Opus' // TODO
    var seqNum = 0
    voiceStream
      .pipe(this._codecs.createEncoderStream(codec))
      .on('data', data => {
        let duration = this._codecs.getDuration(codec, data.frame) / 10
        this._voice.write({
          seqNum: seqNum,
          codec: codec,
          mode: target,
          frames: [data.frame],
          position: data.position,
          end: false
        })
        seqNum += duration
      }).on('end', () => {
        this._voice.write({
          seqNum: seqNum,
          codec: codec,
          mode: target,
          frames: [],
          end: true
        })
      })
    return voiceStream
  }

  /**
   * Method called when new voice packets arrive.
   * Forwards the packet to the source user.
   */
  _onVoice (chunk) {
    var user = this._userById[chunk.source]
    user._onVoice(chunk.seqNum, chunk.codec, chunk.target, chunk.frames,
      chunk.position, chunk.end)
  }

  /**
   * Method called when new data packets arrive.
   * If there is a method named '_onPacketName', the data is forwarded to
   * that method, otherwise it is logged as unhandled.
   *
   * @param {object} chunk - The data packet
   */
  _onData (chunk) {
    if (this['_on' + chunk.name]) {
      this['_on' + chunk.name](chunk.payload)
    } else {
      console.log('Unhandled data packet:', chunk)
    }
  }

  _onUDPTunnel (payload) {
    // Forward tunneled udp packets to the voice pipeline
    this._voiceDecoder.write(payload)
  }

  _onVersion (payload) {
    this.serverVersion = {
      major: payload.version >> 16,
      minor: (payload.version >> 8) & 0xff,
      patch: (payload.version >> 0) & 0xff,
      release: payload.release,
      os: payload.os,
      osVersion: payload.os_version
    }
  }

  _onServerSync (payload) {
    // This packet finishes the initialization phase
    if (this._webrtcRequired && !this._webrtcEnabled) {
      this._error('server_does_not_support_webrtc')
      return
    }

    this.self = this._userById[payload.session]
    this.maxBandwidth = payload.max_bandwidth
    this.welcomeMessage = payload.welcome_text

    // Make sure we send regular ping packets to not get disconnected
    this._pinger = setInterval(() => {
      if (this._inFlightDataPings >= this._maxInFlightDataPings) {
        this._error('timeout')
        return
      }
      let dataStats = this._dataStats.getAll()
      let voiceStats = this._voiceStats.getAll()
      let timestamp = new Date().getTime()
      let payload = {
        timestamp: timestamp
      }
      if (dataStats) {
        payload.tcp_packets = dataStats.n
        payload.tcp_ping_avg = dataStats.mean
        payload.tcp_ping_var = dataStats.variance
      }
      if (voiceStats) {
        payload.udp_packets = voiceStats.n
        payload.udp_ping_avg = voiceStats.mean
        payload.udp_ping_var = voiceStats.variance
      }
      this._send({
        name: 'Ping',
        payload: payload
      })
      this._inFlightDataPings++
    }, this._dataPingInterval)

    // We are now connected
    this.emit('connected')
  }

  _onPing (payload) {
    if (this._inFlightDataPings <= 0) {
      console.warn('Got unexpected ping message:', payload)
      return
    }
    this._inFlightDataPings--

    let now = new Date().getTime()
    let duration = now - payload.timestamp.toNumber()
    this._dataStats.update(duration)
    this.emit('dataPing', duration)
  }

  _onReject (payload) {
    // We got rejected from the server for some reason.
    this.emit('reject', payload)
    this.disconnect()
  }

  _onPermissionDenied (payload) {
    if (payload.type === DenyType.Text) {
      this.emit('denied', 'Text', null, null, payload.reason)
    } else if (payload.type === DenyType.Permission) {
      let user = this._userById[payload.session]
      let channel = this._channelById[payload.channel_id]
      this.emit('denied', 'Permission', user, channel, payload.permission)
    } else if (payload.type === DenyType.SuperUser) {
      this.emit('denied', 'SuperUser', null, null, null)
    } else if (payload.type === DenyType.ChannelName) {
      this.emit('denied', 'ChannelName', null, null, payload.name)
    } else if (payload.type === DenyType.TextTooLong) {
      this.emit('denied', 'TextTooLong', null, null, null)
    } else if (payload.type === DenyType.TemporaryChannel) {
      this.emit('denied', 'TemporaryChannel', null, null, null)
    } else if (payload.type === DenyType.MissingCertificate) {
      let user = this._userById[payload.session]
      this.emit('denied', 'MissingCertificate', user, null, null)
    } else if (payload.type === DenyType.UserName) {
      this.emit('denied', 'UserName', null, null, payload.name)
    } else if (payload.type === DenyType.ChannelFull) {
      this.emit('denied', 'ChannelFull', null, null, null)
    } else if (payload.type === DenyType.NestingLimit) {
      this.emit('denied', 'NestingLimit', null, null, null)
    } else {
      throw Error('Invalid DenyType: ' + payload.type)
    }
  }

  _onTextMessage (payload) {
    this.emit('message',
      this._userById[payload.actor],
      payload.message,
      payload.session.map(id => this._userById[id]),
      payload.channel_id.map(id => this._channelById[id]),
      payload.tree_id.map(id => this._channelById[id])
    )
  }

  _onChannelState (payload) {
    var channel = this._channelById[payload.channel_id]
    if (!channel) {
      channel = new Channel(this, payload.channel_id)
      this._channelById[channel._id] = channel
      this.channels.push(channel)
      this.emit('newChannel', channel)
    }
    (payload.links_remove || []).forEach(otherId => {
      var otherChannel = this._channelById[otherId]
      if (otherChannel && otherChannel.links.indexOf(channel) !== -1) {
        otherChannel._update({
          links_remove: [payload.channel_id]
        })
      }
    })
    channel._update(payload)
  }

  _onChannelRemove (payload) {
    var channel = this._channelById[payload.channel_id]
    if (channel) {
      channel._remove()
      delete this._channelById[channel._id]
      removeValue(this.channels, channel)
    }
  }

  _onUserState (payload) {
    var user = this._userById[payload.session]
    if (!user) {
      user = new User(this, payload.session, payload.ssrc)
      this._userById[user._id] = user
      this.users.push(user)
      this.emit('newUser', user)

      this._updateWebRtc()

      // For some reason, the mumble protocol does not send the initial
      // channel of a client if it is the root channel
      payload.channel_id = payload.channel_id || 0
    }
    user._update(payload)
  }

  _onUserRemove (payload) {
    var user = this._userById[payload.session]
    if (user) {
      user._remove(this._userById[payload.actor], payload.reason, payload.ban)
      delete this._userById[user._id]
      removeValue(this.users, user)
    }
  }

  _createWebRtcOffer () {
    let sdp = []
    // https://tools.ietf.org/html/rfc2327#section-6
    sdp.push('v=0')
    sdp.push('o=- 12345 0 IN IP4 0.0.0.0')
    sdp.push('s=-')
    sdp.push('t=0 0')

    sdp.push('a=sendrecv')
    sdp.push('a=ice-options:trickle')

    sdp.push('a=group:BUNDLE audio' + this.users.map(user => ' audio' + user.ssrc).join(''))

    sdp.push('m=audio 0 UDP/TLS/RTP/SAVPF 97')
    sdp.push('c=IN IP4 0.0.0.0')
    sdp.push('a=recvonly')
    sdp.push('a=fingerprint:sha-256 ' + this._remoteDtlsFingerprint)
    sdp.push('a=ice-pwd:' + this._remoteIcePwd)
    sdp.push('a=ice-ufrag:' + this._remoteIceUfrag)
    sdp.push('a=mid:audio')
    sdp.push('a=rtpmap:97 OPUS/48000/2')
    sdp.push('a=rtcp-mux')
    sdp.push('a=setup:actpass') // see below
    sdp.push('a=bundle-only')

    for (let user of this.users) {
      let ssrc = user.ssrc
      sdp.push('m=audio 0 UDP/TLS/RTP/SAVPF 97')
      sdp.push('c=IN IP4 0.0.0.0')
      sdp.push('a=sendonly')
      sdp.push('a=fingerprint:sha-256 ' + this._remoteDtlsFingerprint)
      sdp.push('a=ice-pwd:' + this._remoteIcePwd)
      sdp.push('a=ice-ufrag:' + this._remoteIceUfrag)
      sdp.push('a=mid:audio' + ssrc)
      sdp.push('a=rtpmap:97 OPUS/48000/2')
      sdp.push('a=rtcp-mux')
      // https://tools.ietf.org/html/rfc4145#section-4
      // Would love to use 'passive' but WebRTC demands 'actpass' for the offerer
      sdp.push('a=setup:actpass')
      sdp.push('a=bundle-only')
      sdp.push(`a=ssrc:${ssrc} cname:audio${ssrc}`)
    }
    sdp.push('')

    return sdp.join('\n')
  }

  _parseWebRtcAnswer (answer) {
    let lines = answer.split(answer.indexOf('\r') === -1 ? '\n' : '\r\n')
    let icePwd, iceUfrag, dtlsFingerprint
    for (let line of lines) {
      if (line.startsWith('a=ice-pwd:')) {
        icePwd = line.substring('a=ice-pwd:'.length)
      }
      if (line.startsWith('a=ice-ufrag:')) {
        iceUfrag = line.substring('a=ice-ufrag:'.length)
      }
      if (line.startsWith('a=fingerprint:sha-256 ')) {
        dtlsFingerprint = line.substring('a=fingerprint:sha-256 '.length)
      }
    }
    return [icePwd, iceUfrag, dtlsFingerprint]
  }

  _updateWebRtc () {
    if (!this._remoteIcePwd) {
      return
    }

    this._updateWebRtcPromise =
      (this._updateWebRtcPromise || Promise.resolve()).then(() => {
        return this._pc.setRemoteDescription(new window.RTCSessionDescription({
          type: 'offer',
          sdp: this._createWebRtcOffer()
        }))
      }).then(() => {
        return this._pc.createAnswer()
      }).then((answer) => {
        if (!this._hasSentWebRtcInit) {
          let [icePwd, iceUfrag, dtlsFingerprint] = this._parseWebRtcAnswer(answer.sdp)
          this._send({
            name: 'WebRTC',
            payload: {
              ice_pwd: icePwd,
              ice_ufrag: iceUfrag,
              dtls_fingerprint: dtlsFingerprint
            }
          })
          this._hasSentWebRtcInit = true
        }
        // server is always passive -> we always need to be active
        answer.sdp = answer.sdp.replace(/a=setup:passive/g, 'a=setup:active')
        return this._pc.setLocalDescription(answer)
      }).catch(err => console.error(err))
  }

  _onWebRTC (payload) {
    if (!this._pc) {
      return
    }
    this._webrtcEnabled = true

    this._remoteIcePwd = payload.ice_pwd
    this._remoteIceUfrag = payload.ice_ufrag
    this._remoteDtlsFingerprint = payload.dtls_fingerprint

    this._updateWebRtc()
  }

  _onIceCandidate (payload) {
    if (this._pc) {
      this._pc.addIceCandidate(new window.RTCIceCandidate({
        sdpMLineIndex: 0,
        candidate: payload.content
      }), () => {}, console.error)
    }
  }

  _onTalkingState (payload) {
    var user = this._userById[payload.session]
    if (user) {
      if (payload.target != null) {
        user._getOrCreateVoiceStream({
          0: 'normal',
          1: 'shout',
          2: 'whisper',
          31: 'loopback'
        }[payload.target])
      } else if (user._voice) {
        user._voice.end()
        user._voice = null
      }
    }
  }

  /**
   * Disconnect from the remote server.
   * Once disconnected, this client may not be used again.
   * Does nothing when not connected.
   */
  disconnect () {
    if (this._disconnected) {
      return
    }
    this._disconnected = true
    this._voice.end()
    this._data.end()
    clearInterval(this._pinger)

    this.emit('disconnected')
  }

  /**
   * Set preferred audio bitrate and samples per packet.
   *
   * The {@link PCMData} passed to the stream returned by {@link createVoiceStream} must
   * contain the appropriate amount of samples per channel for bandwidth control to
   * function as expected.
   *
   * If this method is never called or false is passed as one of the values, then the
   * samplesPerPacket are determined by inspecting the {@link PCMData} passed and the
   * bitrate is calculated from the maximum bitrate advertised by the server.
   *
   * @param {number} bitrate - Preferred audio bitrate, sensible values are 8k to 96k
   * @param {number} samplesPerPacket - Amount of samples per packet, valid values depend on the codec used but all should support 10ms (i.e. 480), 20ms, 40ms and 60ms
   */
  setAudioQuality (bitrate, samplesPerPacket) {
    this._preferredBitrate = bitrate
    this._samplesPerPacket = samplesPerPacket
  }

  /**
   * Calculate the actual bitrate taking into account maximum and preferred bitrate.
   */
  getActualBitrate (samplesPerPacket, sendPosition) {
    let bitrate = this.getPreferredBitrate(samplesPerPacket, sendPosition)
    let bandwidth = MumbleClient.calcEnforcableBandwidth(bitrate, samplesPerPacket, sendPosition)
    if (bandwidth <= this.maxBandwidth) {
      return bitrate
    } else {
      return this.getMaxBitrate(samplesPerPacket, sendPosition)
    }
  }

  /**
   * Returns the preferred bitrate set by {@link setAudioQuality} or
   * {@link getMaxBitrate} if not set.
   */
  getPreferredBitrate (samplesPerPacket, sendPosition) {
    if (this._preferredBitrate) {
      return this._preferredBitrate
    }
    return this.getMaxBitrate(samplesPerPacket, sendPosition)
  }

  /**
   * Calculate the maximum bitrate possible given the current server bandwidth limit.
   */
  getMaxBitrate (samplesPerPacket, sendPosition) {
    let overhead = MumbleClient.calcEnforcableBandwidth(0, samplesPerPacket, sendPosition)
    return this.maxBandwidth - overhead
  }

  /**
   * Calculate the bandwidth used if IP/UDP packets were used to transmit audio.
   * This matches the value used by Mumble servers to enforce bandwidth limits.
   * @returns {number} bits per second
   */
  static calcEnforcableBandwidth (bitrate, samplesPerPacket, sendPosition) {
    // IP + UDP + Crypt + Header + SeqNum (VarInt) + Codec Header + Optional Position
    // Codec Header depends on codec:
    //  - Opus is always 4 (just the length as VarInt)
    //  - CELT/Speex depends on frames (10ms) per packet (1 byte each)
    let codecHeaderBytes = Math.max(4, samplesPerPacket / 480)
    let packetBytes = 20 + 8 + 4 + 1 + 4 + codecHeaderBytes + (sendPosition ? 12 : 0)
    let packetsPerSecond = 48000 / samplesPerPacket
    return Math.round(packetBytes * 8 * packetsPerSecond + bitrate)
  }

  /**
   * Find a channel by name.
   * If no such channel exists, return null.
   *
   * @param {string} name - The full name of the channel
   * @returns {?Channel}
   */
  getChannel (name) {
    for (let channel of this.channels) {
      if (channel.name === name) {
        return channel
      }
    }
    return null
  }

  setSelfMute (mute) {
    var message = {
      name: 'UserState',
      payload: {
        session: this.self._id,
        self_mute: mute
      }
    }
    if (!mute) message.payload.self_deaf = false
    this._send(message)
  }

  setSelfDeaf (deaf) {
    var message = {
      name: 'UserState',
      payload: {
        session: this.self._id,
        self_deaf: deaf
      }
    }
    if (deaf) message.payload.self_mute = true
    this._send(message)
  }

  setSelfTexture (texture) {
    this._send({
      name: 'UserState',
      payload: {
        session: this.self._id,
        texture: texture
      }
    })
  }

  setSelfComment (comment) {
    this._send({
      name: 'UserState',
      payload: {
        session: this.self._id,
        comment: comment
      }
    })
  }

  setPluginContext (context) {
    this._send({
      name: 'UserState',
      payload: {
        session: this.self._id,
        plugin_context: context
      }
    })
  }

  setPluginIdentity (identity) {
    this._send({
      name: 'UserState',
      payload: {
        session: this.self._id,
        plugin_identity: identity
      }
    })
  }

  setRecording (recording) {
    this._send({
      name: 'UserState',
      payload: {
        session: this.self._id,
        recording: recording
      }
    })
  }

  getChannelById (id) {
    return this._channelById[id]
  }

  getUserById (id) {
    return this._userById[id]
  }

  get root () {
    return this._channelById[0]
  }

  get connected () {
    return !this._disconnected && this._dataStream != null
  }

  get dataStats () {
    return this._dataStats.getAll()
  }

  get voiceStats () {
    return this._voiceStats.getAll()
  }
}

export default MumbleClient
