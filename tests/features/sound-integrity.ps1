$ErrorActionPreference = 'Stop'
& node --experimental-strip-types (Join-Path $PSScriptRoot 'sound-integrity.mjs')
if ($LASTEXITCODE -ne 0) { throw 'sound integrity assertions failed' }
