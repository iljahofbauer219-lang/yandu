import { multiply } from './calculator.js'

if (multiply(2, 3) !== 6) {
  throw new Error(`Expected 6, received ${multiply(2, 3)}`)
}

console.log('PHASE4_RUNTIME_TEST_OK')
