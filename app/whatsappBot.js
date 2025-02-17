const wppconnect = require('@wppconnect-team/wppconnect')
const { main } = require('./assistant')
const { FishBrain } = require('./fishbrain')
let client

if (process.env.ENVIRONMENT !== 'localhost') {
  wppconnect
    .create({
      session: process.env.WHATSAPP_SESSION,
      autoClose: false,
      headless: 'new',
      puppeteerOptions: {
        args: ['--no-sandbox']
      }
    })
    .then((c) => start(c))
    .catch((error) => console.log(error))
}

const pluralize = (n, string) => n > 1 ? `${string}s` : string

const localeTime = (date) => {
  const newDate = new Date(date)
  return newDate.toLocaleTimeString(
    'es-MX',
    { hour12: true, hour: 'numeric', minute: 'numeric', timeZone: 'America/Mexico_City' }
  )
}

const status = async (message, report = true) => {
  const roadies = FishBrain.getRoadies()
  const chat = await client.getChatById(message.chatId)
  const chatName = chat.name || chat.contact.name
  const msgs = ['🚨PILOTOS ACTIVOS🚨']
  roadies
    .filter(([key, { value }]) => value.channel === message.from)
    .forEach(([key, { value }]) => {
      const { id, destination, people, vehicles, calculatedETA } = value
      const aprox = localeTime(calculatedETA)
      const ppls = `${people} ${pluralize(people, 'persona')}`
      const motos = `${vehicles} ${pluralize(vehicles, 'moto')}`
      const msg = `🏍️ @${id} (${ppls}, ${motos}) en ruta a ${destination}. ETA: ${aprox}`
      msgs.push(msg)
    })
  if (msgs.length === 1) {
    client.sendText(message.from, 'no hay pilotos activos').then(_ => { }).catch(console.error)
    if (chatName.includes('🚨')) client.setGroupSubject(message.chatId, chatName.replace(/🚨/g, ''))
    return
  }
  if (report) client.sendText(message.from, msgs.join('\n')).then(_ => {}).catch(console.error)
}

const start = c => {
  client = c
  FishBrain.setCallback(expired => {
    const channels = {}
    expired.forEach(([key, { value }]) => {
      const { channel } = value
      if (!channels[channel]) channels[channel] = []
      channels[channel].push(value)
    })
    Object.entries(channels).forEach(([channel, roadies]) => {
      const msgs = ['🚨REPORTAR STATUS🚨']
      roadies.forEach(({ id, destination, people, vehicles, calculatedETA }) => {
        const aprox = localeTime(calculatedETA)
        const ppls = `${people} ${pluralize(people, 'persona')}`
        const motos = `${vehicles} ${pluralize(vehicles, 'moto')}`
        const msg = `🏍️ @${id} (${ppls}, ${motos}) en ruta a ${destination}. ETA: ${aprox}`
        msgs.push(msg)
        FishBrain.store(`roadie-${id}`, { channel, id, destination, people, vehicles, calculatedETA }, 1000 * 60 * 30)
      })
      if (msgs.length === 1) return
      msgs.push('\nEste mensaje se repetira cada 30 minutos hasta que se reporten todas las llegadas')
      client.sendText(channel, msgs.join('\n')).then(_ => {}).catch(console.error)
    })
  })
  client.onMessage(async message => {
    if (
      process.env.ENVIRONMENT === 'production' &&
      message.chatId === process.env.WHATSAPP_DEV_CHANNEL
    ) return
    if (process.env.ENVIRONMENT === 'development' &&
      message.chatId !== process.env.WHATSAPP_DEV_CHANNEL
    ) return
    let response
    if (!message.content) return
    let [number] = message.sender.id.split('@')
    const text = message.content.toLowerCase()
    const cleanedText = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    if (cleanedText.includes('reporto salida')) {
      if (cleanedText.includes('reporto salida a nombre de')) {
        const [_, name] = cleanedText.split('nombre de')
        number = name.trim().replace('@', '').split(' ')[0]
      }
      const chat = await client.getChatById(message.chatId)
      const chatName = chat.name || chat.contact.name
      const assistant = await main()
      const { status, data } = await assistant(text)
      if (!status === 'success') return
      const { people: _p, vehicles: _v, destination, eta } = data
      const vehicles = Math.max(1, ~~_v)
      const people = Math.max(1, ~~_p)
      const motos = `${vehicles} ${pluralize(vehicles, 'moto')}`
      const ppls = `${people} ${pluralize(people, 'persona')}`
      const calculatedETA = new Date(Date.now() + eta * 1000)
      const aprox = localeTime(calculatedETA)
      FishBrain.store(
        `roadie-${number}`,
        {
          channel: message.from,
          id: number,
          destination,
          people,
          vehicles,
          calculatedETA
        },
        eta * 1000
      )
      if (!chatName.includes('🚨')) client.setGroupSubject(message.chatId, `🚨${chatName}🚨`)
      response = `🏍️ @${number} (${ppls}, ${motos}) en ruta a ${destination}. ETA: ${aprox}`
      return client.sendText(message.from, response).then(_ => {}).catch(console.error)
    }

    if (cleanedText.includes('reporto llegada')) {
      if (cleanedText.includes('reporto llegada a nombre de')) {
        const [_, name] = cleanedText.split('nombre de')
        number = name.trim().replace('@', '').split(' ')[0]
      }
      response = `📍 @${number} llegó a destino`
      FishBrain.delete(`roadie-${number}`)
      status(message, false)
      return client.sendText(message.from, response).then(_ => {}).catch(console.error)
    }

    if (cleanedText.includes('como va la rodada')) {
      return status(message)
    }

    if (message.content !== 'ping') return
    console.log(message)
    client.sendText(message.from, 'pong').then(_ => {}).catch(console.error)
  })
}

const sendAlert = msg => {
  if (process.env.ENVIRONMENT === 'localhost') return
  client.sendText(process.env.WHATSAPP_CHANNEL, msg)
    .then(console.log)
    .catch(console.error)
}

module.exports = {
  sendAlert
}
