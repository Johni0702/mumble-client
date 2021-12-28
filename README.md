# mumble-client (upgraded to Babel 7 and JS Standard v16)

This module implements the client side of the Mumble protocol for use in both Nodejs and the browser.
It does not enforce any particular transport protocol nor does it provide the audio encoder/decoder.
See [mumble-client-tcp] and [mumble-client-udp] and [mumble-client-codecs-node] for creating a Nodejs based application or
[mumble-client-websocket] and [mumble-client-codecs-browser] for a browser app.

### Usage

Node: All functions that take a Node-style callback as their last argument may also be used without that callback and will then instead return a [Promise].

Most transport modules will have their own MumbleClient factory functions.
Therefore this is only of importance if you do not wish to use any transport module or are implementing your one.
Note that encryption of the data stream has to be done by the transport module while the voice stream is encrypted by this module.
```javascript
var MumbleClient = require('mumble-client')
var client = new MumbleClient({
  username: 'Test',
  password: 'Pass123'
})
// someDuplexStream is used for data transmission and as a voice channel fallback
client.connectDataStream(someDuplexStream, function (err, client) {
  if (err) throw err

  // Connection established
  console.log('Welcome message:', client.welcomeMessage)
  console.log('Actual username:', client.self.username)

  // Optionally connect a potentially lossy, udp-like voice channel
  client.connectVoiceStream(someOtherDuplexStream)
  
  var testChannel = client.getChannel('Test Channel')
  if (testChannel) {
    client.self.setChannel(testChannel)
  }

  client.users.forEach(function (user) {
    console.log('User', user.username, 'is in channel', user.channel.name)
  })
})

// You may then register listeners for the 'voice' event to receive a stream
// of raw PCM frames.
client.on('newUser', function (user) {
  user.on('voice', function (stream) {
    stream.on('data', function (data) {
      // Interleaved IEEE754 32-bit linear PCM with nominal range between -1 and +1
      // May be of zero length which is usually only the case when voice.end is true
      console.log(data.pcm) // Float32Array
      console.log(data.numberOfChannels)
      
      // Target indicates who the user is talking to
      // Can be one of: 'normal', 'whisper', 'shout'
      console.log(data.target)

      // Neither numberOfChannels nor target should normally change during one 
      // transmission however this cannot be guaranteed
    }).on('end', function () {
      // The current voice transmission has ended, stateful decoders have been reset
      // Can be used to disable the 'talking' indicator of this use
      // Because the last packet might get lost due to packet loss, a timer is
      // used to always fire this event. As a result a single transmission might
      // be split when packets are delayed.
      console.log(user.username, 'stopped talking.')
    })
  })
})

// To send audio, pipe your raw PCM samples (as Float32Array or Buffer) at 
// 48kHz into an outgoing stream created with Client#createVoiceStream.
// Any audio piped in the stream while muted, suppressed or not yet connected
// will be silently dropped.
// First argument is the target: 0 is normal talking, 1-31 are voice targets
var voiceStream = client.createVoiceStream(0)
myPcmSource.pipe(voiceStream)
// Make sure the stream is ended when the transmission should end
// For positional audio the Float32Array is wrapped in an object which
// also contains the position:
myPcmSource.on('data', function (chunk) {
  voiceStream.write({
    pcm: chunk,
    x: 1,
    y: 2.5,
    z: 3
  })
})
```

### License
MIT

[mumble-client-tcp]: https://github.com/johni0702/mumble-client-tcp
[mumble-client-udp]: https://github.com/johni0702/mumble-client-udp
[mumble-client-websocket]: https://github.com/johni0702/mumble-client-websocket
[mumble-client-codecs-node]: https://github.com/johni0702/mumble-client-codecs-node
[mumble-client-codecs-browser]: https://github.com/johni0702/mumble-client-codecs-browser
[Promise]: https://github.com/then/promise
