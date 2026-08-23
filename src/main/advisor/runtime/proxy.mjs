import net from 'node:net'

const targetHost = '127.0.0.1'
const targetPort = 3080

net.createServer(client => {
  const upstream = net.connect(targetPort, targetHost)
  client.pipe(upstream)
  upstream.pipe(client)
  const close = () => {
    client.destroy()
    upstream.destroy()
  }
  client.once('error', close)
  upstream.once('error', close)
}).listen(8080, '0.0.0.0')
