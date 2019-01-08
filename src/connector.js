const util = require('util')
const request = require('request')
const uuidv4 = require('uuid/v4')
const debug = require('debug')('botium-connector-botkit')
const WebSocket = require('ws')

const Capabilities = {
  BOTKIT_SERVER_URL: 'BOTKIT_SERVER_URL',
  BOTKIT_WEBSOCKET: 'BOTKIT_WEBSOCKET',
  BOTKIT_USERID: 'BOTKIT_USERID'
}

class BotiumConnectorBotkit {
  constructor ({ queueBotSays, caps }) {
    this.queueBotSays = queueBotSays
    this.caps = caps
    this.userId = null
    this.wsConnected = true
    debug(this.caps[Capabilities.BOTKIT_WEBSOCKET])
    debug(this.caps[Capabilities.BOTKIT_SERVER_URL])
    if (this.caps[Capabilities.BOTKIT_WEBSOCKET]) {
      this.ws = new WebSocket(this.caps[Capabilities.BOTKIT_SERVER_URL])

      this.ws.on('message', this._onBotMessage.bind(this))
    }
  }

  Validate () {
    debug('Validate called')

    if (!this.caps[Capabilities.BOTKIT_SERVER_URL]) {
      throw new Error('BOTKIT_SERVER_URL capability required')
    }

    if (this.caps[Capabilities.BOTKIT_WEBSOCKET]) {
      return new Promise((resolve, reject) => {
        this.ws.on('open', () => {
          this.wsConnected = true
          resolve()
        })

        setTimeout(() => {
          reject(new Error(`websocket connection failed: ${this.ws}`))
        }, 10000)
      })
    }

    return Promise.resolve()
  }

  Start () {
    debug('Start called')

    if (this.caps[Capabilities.BOTKIT_USERID]) {
      this.userId = this.caps[Capabilities.BOTKIT_USERID]
    } else {
      this.userId = uuidv4()
    }
  }

  UserSays (msg) {
    debug(`UserSays called ${util.inspect(msg)}`)
    return this._sendMessage(msg)
  }

  Stop () {
    debug('Stop called')
    this.ws.close()
    this.userId = null
  }

  _sendMessage (msg) {
    if (!this.caps[Capabilities.BOTKIT_WEBSOCKET]) return this._doRequest(msg)

    if (!this.wsConnected) {
      throw new Error(`websocket connection failed: ${this.ws}`)
    }

    this.ws.send(
      JSON.stringify({
        text: msg.messageText,
        user: this.userId,
        channel: 'websocket'
      })
    )
  }

  _onBotMessage (msgString) {
    try {
      const msg = JSON.parse(msgString)

      if (msg.type !== 'message') return

      const botMsg = this._processMessage(msg)
      this.queueBotSays(botMsg)
    } catch (e) {
      throw new Error(
        `Error parsing incoming message from websocket. Message must be JSON ${e}`
      )
    }
  }

  _doRequest (msg) {
    return new Promise((resolve, reject) => {
      const requestOptions = this._buildRequest(msg)
      debug(
        `constructed requestOptions ${JSON.stringify(requestOptions, null, 2)}`
      )

      request(requestOptions, (err, response, body) => {
        if (err) {
          reject(new Error(`rest request failed: ${util.inspect(err)}`))
        } else {
          if (response.statusCode >= 400) {
            debug(
              `got error response: ${response.statusCode}/${
                response.statusMessage
              }`
            )
            return reject(
              new Error(
                `got error response: ${response.statusCode}/${
                  response.statusMessage
                }`
              )
            )
          }
          resolve(this)

          if (body) {
            debug(`got response body: ${JSON.stringify(body, null, 2)}`)

            const botMsg = this._processMessage(msg)
            this.queueBotSays(botMsg)
          }
        }
      })
    })
  }

  _processMessage (msg) {
    const botMsg = {
      sourceData: msg
    }

    if (msg.text) {
      botMsg.messageText = msg.text
    }
    if (msg.quick_replies) {
      botMsg.buttons = msg.quick_replies.map(q => ({
        text: q.title,
        payload: q.payload
      }))
    }
    if (msg.files) {
      botMsg.media = msg.files.map(f => ({
        mediaUri: f.url
      }))
    }

    return botMsg
  }

  _buildRequest (msg) {
    const uri = `${this.caps[Capabilities.BOTKIT_SERVER_URL]}/botkit/receive`

    const requestOptions = {
      uri,
      method: 'POST',
      json: true,
      body: {
        text: msg.messageText,
        user: this.userId,
        channel: 'webhook'
      }
    }
    return requestOptions
  }
}

module.exports = BotiumConnectorBotkit
