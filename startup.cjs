// startup.cjs — cPanel Node.js Selector için giriş noktası
// .cjs uzantısı package.json "type":"module"'ü bypass eder
'use strict';

process.env.NODE_ENV = process.env.NODE_ENV || 'production';

// tsx v4 CJS hook'unu kaydet — TypeScript'i direkt çalıştırır
require('tsx/cjs');
require('./server.ts');
