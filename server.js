/* Servidor de desenvolvimento opcional, usando apenas módulos nativos do Node.js. */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const port = Number(process.env.PORT) || 3333;
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp'
};

const server = http.createServer((request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' });
    response.end('Método não permitido.');
    return;
  }
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  } catch {
    response.writeHead(400);
    response.end('Endereço inválido.');
    return;
  }
  // Metadados do Git, configurações e outros arquivos ocultos não fazem parte do site.
  if (pathname.split(/[\\/]/).some(segment => segment.startsWith('.'))) {
    response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Acesso não permitido.');
    return;
  }
  const filePath = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  const relative = path.relative(root, filePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    response.writeHead(403);
    response.end('Acesso não permitido.');
    return;
  }
  fs.stat(filePath, (error, stat) => {
    if (error || !stat.isFile()) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Arquivo não encontrado.');
      return;
    }
    response.writeHead(200, {
      'Content-Type': types[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': 'no-cache'
    });
    if (request.method === 'HEAD') { response.end(); return; }
    const stream = fs.createReadStream(filePath);
    stream.on('error', () => response.destroy());
    stream.pipe(response);
  });
});
server.on('error', error => {
  console.error(error.code === 'EADDRINUSE'
    ? `A porta ${port} já está em uso. Use outra porta com a variável PORT.`
    : `Não foi possível iniciar o servidor: ${error.message}`);
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => {
  console.log(`Happy disponível em http://localhost:${port}`);
  console.log('Para encerrar, pressione Ctrl+C.');
});
