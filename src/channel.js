import { EventEmitter } from 'events'
import removeValue from 'remove-value'

class Channel extends EventEmitter {
  constructor (client, id) {
    super()
    this._client = client
    this._id = id
    this._links = []
    this.users = []
    this.children = []
  }

  _remove () {
    if (this.parent) {
      removeValue(this.parent.children, this)
    }
    this.emit('remove')
  }

  _update (msg) {
    var changes = {}
    if (msg.name != null) {
      changes.name = this._name = msg.name
    }
    if (msg.description != null) {
      changes.description = this._description = msg.description
    }
    if (msg.description_hash != null) {
      changes.descriptionHash = this._descriptionHash = msg.description_hash
    }
    if (msg.temporary != null) {
      changes.temporary = this._temporary = msg.temporary
    }
    if (msg.position != null) {
      changes.position = this._position = msg.position
    }
    if (msg.max_users != null) {
      changes.maxUsers = this._maxUsers = msg.max_users
    }
    if (msg.links) {
      this._links = msg.links
      changes.links = this.links
    }
    if (msg.links_remove) {
      this._links = this._links.filter(e => !msg.links_remove.includes(e))
      changes.links = this.links
    }
    if (msg.links_add) {
      msg.links_add.filter(e => !this._links.includes(e)).forEach(e => this._links.push(e))
      changes.links = this.links
    }
    if (msg.parent != null) {
      if (this.parent) {
        removeValue(this.parent.children, this)
      }
      this._parentId = msg.parent
      if (this.parent) {
        this.parent.children.push(this)
      }
      changes.parent = this.parent
    }
    this.emit('update', changes)
  }

  setName (name) {
    this._client._send({
      name: 'ChannelState',
      payload: {
        channel_id: this._id,
        name: name
      }
    })
  }

  setParent (parent) {
    this._client._send({
      name: 'ChannelState',
      payload: {
        channel_id: this._id,
        parent: parent._id
      }
    })
  }

  setTemporary (temporary) {
    this._client._send({
      name: 'ChannelState',
      payload: {
        channel_id: this._id,
        temporary: temporary
      }
    })
  }

  setDescription (description) {
    this._client._send({
      name: 'ChannelState',
      payload: {
        channel_id: this._id,
        description: description
      }
    })
  }

  setPosition (position) {
    this._client._send({
      name: 'ChannelState',
      payload: {
        channel_id: this._id,
        position: position
      }
    })
  }

  setLinks (links) {
    this._client._send({
      name: 'ChannelState',
      payload: {
        channel_id: this._id,
        links: links.map(c => c._id)
      }
    })
  }

  setMaxUsers (maxUsers) {
    this._client._send({
      name: 'ChannelState',
      payload: {
        channel_id: this._id,
        max_users: maxUsers
      }
    })
  }

  sendMessage (message) {
    this._client._send({
      name: 'TextMessage',
      payload: {
        channel_id: [this._id],
        message: message
      }
    })
  }

  sendTreeMessage (message) {
    this._client._send({
      name: 'TextMessage',
      payload: {
        tree_id: [this._id],
        message: message
      }
    })
  }

  get name () {
    return this._name
  }

  set name (to) {
    throw new Error('Cannot set name. Use #setName(name) instead.')
  }

  get parent () {
    return this._client._channelById[this._parentId]
  }

  set parent (to) {
    throw new Error('Cannot set parent. Use #setParent(channel) instead.')
  }

  get description () {
    return this._description
  }

  set description (to) {
    throw new Error('Cannot set description. Use #setDescription(desc) instead.')
  }

  get descriptionHash () {
    return this._descriptionHash
  }

  set descriptionHash (to) {
    throw new Error('Cannot set descriptionHash.')
  }

  get temporary () {
    return this._temporary
  }

  set temporary (to) {
    throw new Error('Cannot set temporary. Use #setTemporary(tmp) instead.')
  }

  get position () {
    return this._position
  }

  set position (to) {
    throw new Error('Cannot set position.')
  }

  get maxUsers () {
    return this._maxUsers
  }

  set maxUsers (to) {
    throw new Error('Cannot set maxUsers.')
  }

  get links () {
    return this._links.map(id => this._client._channelById[id])
  }

  set links (to) {
    throw new Error('Cannot set links. Use #setLinks(links) instead.')
  }
}

export default Channel
