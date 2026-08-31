import { describe, expect, it } from 'vitest'

import { masked, REDACTED } from './mask'

/**
 * Both directions, because a mask can fail in two opposite ways.
 *
 * A mask that misses a key leaks it to a service. A mask that eats a sentence
 * makes her quote somebody's words back to them wrongly, with no way for the
 * listener to notice. The second failure is quieter and is why every case below
 * has a near-miss beside it.
 */

describe('what the mask removes', () => {
  it('removes an OpenAI-style key', () => {
    const said = `I set OPENAI_API_KEY to sk-${'a1B2c3D4e5F6g7H8i9J0'} in the shell`
    expect(masked(said)).toContain(REDACTED)
    expect(masked(said)).not.toContain('a1B2c3D4e5')
  })

  it('removes a modern hyphenated OpenAI key', () => {
    /*
      THE HOLE THE FIRST VERSION HAD, and it was the likeliest format to meet.

      `sk-proj-…` and `sk-svcacct-…` are what OpenAI issues now. A tail that
      stopped at the second hyphen saw four characters where it wanted twenty,
      so the two most common current key shapes passed through unmasked into a
      payload that is sent to a service.
    */
    for (const canary of [
      `sk-proj-${'Ab1Cd2Ef3Gh4Ij5Kl6Mn7Op8Qr9St0Uv'}`,
      `sk-svcacct-${'Ab1Cd2Ef3Gh4Ij5Kl6Mn7Op8'}`,
      `sk-admin-${'Ab1Cd2Ef3Gh4Ij5Kl6Mn7Op8'}`,
    ]) {
      expect(masked(`the key is ${canary} apparently`)).toBe(`the key is ${REDACTED} apparently`)
    }
  })

  it('removes every documented GitHub token prefix, not only two of them', () => {
    // `ghp_` and `gho_` were the two the plan named. `ghu_`, `ghs_` and `ghr_`
    // are documented too, and `github_pat_` is the FINE-GRAINED PAT — the
    // long-lived one, and the one that was missing entirely.
    const body = '0123456789abcdefghijABCDEF'
    for (const prefix of ['ghp_', 'gho_', 'ghu_', 'ghs_', 'ghr_', 'github_pat_']) {
      expect(masked(`${prefix}${body}`)).toBe(REDACTED)
    }
  })

  it('removes a GitHub token', () => {
    const said = `use ghp_${'0123456789abcdefghijABCDEF'} for the push`
    expect(masked(said)).not.toContain('0123456789abcdef')
    expect(masked(`gho_${'0123456789abcdefghijABCDEF'}`)).toBe(REDACTED)
  })

  it('removes an AWS access key id', () => {
    expect(masked('the id is AKIAIOSFODNN7EXAMPLE and the region is eu-west-1')).toBe(
      `the id is ${REDACTED} and the region is eu-west-1`,
    )
  })

  it('removes a temporary AWS key id as well as a long-lived one', () => {
    // `ASIA` is what STS issues, and it is the likelier of the two to have been
    // pasted into a conversation about why something stopped working.
    expect(masked('the id is ASIAIOSFODNN7EXAMPLE today')).toBe(`the id is ${REDACTED} today`)
  })

  it('removes a secret that is named and then assigned', () => {
    /*
      What a pasted `.env` looks like. The other forms recognise a credential by
      its own shape; an AWS secret access key is forty characters of base64 and
      has none, so the only thing to recognise is the name in front of it.
    */
    for (const line of [
      'AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY',
      'OPENAI_API_KEY: "abcdefghijklmnopqrstuvwxyz012345"',
      'NPM_TOKEN=npm_0123456789abcdefghij',
    ]) {
      expect(masked(line)).toContain(REDACTED)
      expect(masked(line)).not.toContain('EXAMPLEKEY')
      expect(masked(line)).not.toContain('abcdefghijklmnop')
    }
  })

  it('leaves a secret NAME alone when nothing is assigned to it', () => {
    // The name is not the secret. "We set it in the environment" is a sentence
    // somebody says, and mangling it would be the mask eating prose.
    const said = 'we set AWS_SECRET_ACCESS_KEY in the environment and it worked'
    expect(masked(said)).toBe(said)
  })

  it('removes a PEM block, body and all', () => {
    /*
      THE BODY, not only the marker. A hit is clipped to three hundred
      characters, so masking the `-----BEGIN` line alone would leave the first
      two hundred and fifty characters of the key in the payload.
    */
    const key = [
      '-----BEGIN OPENSSH PRIVATE KEY-----',
      'b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAAB',
      '-----END OPENSSH PRIVATE KEY-----',
    ].join('\n')
    const out = masked(`here it is:\n${key}\nthat is all`)
    expect(out).not.toContain('b3BlbnNzaC1r')
    expect(out).toBe(`here it is:\n${REDACTED}\nthat is all`)
  })

  it('removes a PEM block that has been cut off part way', () => {
    // A clipped block is still a block, and the half that survives clipping is
    // the half that matters.
    const out = masked('-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEAx')
    expect(out).not.toContain('MIIEpAIBAAKCAQEAx')
  })
})

describe('what the mask must leave alone', () => {
  it('does not mangle prose that happens to contain the prefixes', () => {
    /*
      THE FAILURE THAT IS QUIETER THAN A LEAK. Both of these contain `sk-`
      followed by more than twenty characters, and neither is a key. The word
      boundary and the refusal of hyphens inside the tail are what separate them.
    */
    for (const said of [
      'we agreed on a risk-based-authentication-system for the console',
      'she is risk-averse about the migration',
      'the task-based-scheduler-implementation landed on Tuesday',
      'ask-and-you-shall-receive was the whole approach',
    ]) {
      expect(masked(said)).toBe(said)
    }
  })

  it('leaves a short sk- fragment alone', () => {
    expect(masked('sk-abc')).toBe('sk-abc')
  })

  it('still leaves hyphenated prose alone now that the tail admits hyphens', () => {
    /*
      THE RISK THE WIDENING CREATED, checked rather than assumed. The tail now
      accepts `-`, so the word boundary is the only thing standing between this
      mask and every hyphenated compound in the corpus. Every one of these is
      longer than twenty characters after its `sk-`.
    */
    for (const said of [
      'the risk-based-authentication-system landed on Tuesday',
      'a task-based-scheduling-implementation, roughly',
      'we used a disk-backed-cache-implementation instead',
      'ask-and-you-shall-receive-eventually was the approach',
      'the mask-driven-redaction-strategy is conservative',
    ]) {
      expect(masked(said)).toBe(said)
    }
  })

  it('leaves ordinary capitals alone', () => {
    expect(masked('AKIA is a prefix AWS uses')).toBe('AKIA is a prefix AWS uses')
  })

  it('leaves text with nothing in it untouched', () => {
    expect(masked('')).toBe('')
    expect(masked('what did we decide about the fonts')).toBe('what did we decide about the fonts')
  })
})

describe('what the mask does not claim', () => {
  it('lets an unknown secret shape through, which is why the README says so', () => {
    /*
      STATED AS A TEST rather than as a caveat, because the caveat is the part
      most likely to be dropped. "No regex catches every secret" is not a reason
      to skip the known forms — and it is also not something this may be
      described as having solved.
    */
    const said = 'the database password is hunter2-correct-horse'
    expect(masked(said)).toBe(said)
  })
})
