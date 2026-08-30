import http from 'node:http';
import { Innertube } from 'youtubei.js';

const port = Number(process.env.PORT || 8787);
let clientPromise;
async function client() { return clientPromise ??= Innertube.create(); }
function idOf(url) { return new URL(url).searchParams.get('v') || url.match(/youtu\.be\/([^?]+)/)?.[1]; }
async function metadata(url) {
  const info = await (await client()).getBasicInfo(idOf(url));
  const video = info.basic_info;
  return { title: video.title, channel: video.author, duration_sec: video.duration, thumbnail_url: video.thumbnail?.[0]?.url, provider: 'youtubei.js' };
}
const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/health') return res.end('ok');
    if (req.method !== 'POST' || req.url !== '/metadata') return res.writeHead(404).end();
    let body=''; for await (const chunk of req) body += chunk;
    const result = await metadata(JSON.parse(body).url);
    res.setHeader('content-type','application/json'); res.end(JSON.stringify(result));
  } catch (error) { res.writeHead(502, {'content-type':'application/json'}).end(JSON.stringify({error: error.constructor.name})); }
});
server.listen(port, '0.0.0.0');
