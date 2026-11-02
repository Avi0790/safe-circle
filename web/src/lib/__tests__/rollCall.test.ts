import { rollCallTally } from '../rollCall'

describe('roll call tally', () => {
  it('counts who has not answered, never below zero', () => {
    expect(rollCallTally({ asked: 5, safe: 3, help: 1 }).waiting).toBe(1)
    expect(rollCallTally({ asked: 1, safe: 1, help: 1 }).waiting).toBe(0)
  })
})
