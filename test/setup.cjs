const fs = require('node:fs')
const path = require('node:path')

const target = path.join(process.cwd(), '.test-build')
fs.mkdirSync(target, { recursive: true })
fs.writeFileSync(
  path.join(target, 'package.json'),
  JSON.stringify({ type: 'commonjs' }, null, 2) + '\n',
  'utf8',
)
