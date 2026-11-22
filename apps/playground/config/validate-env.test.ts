import assert from 'node:assert/strict'
import test from 'node:test'
import { validatePlaygroundEnvironment } from './validate-env'

test('validation errors contain key names but never environment values', () => {
    const secret = 'should-never-appear-in-build-output'

    assert.throws(
        () =>
            validatePlaygroundEnvironment({
                APP_VARIANT: secret,
                EAS_PROJECT_ID: '',
                UNRELATED_CREDENTIAL: secret,
            }),
        (error: unknown) => {
            assert.ok(error instanceof Error)
            const serialized = `${error.message}\n${error.stack}\n${JSON.stringify(error)}`
            assert.match(serialized, /APP_VARIANT/)
            assert.match(serialized, /EAS_PROJECT_ID/)
            assert.doesNotMatch(serialized, new RegExp(secret))
            assert.doesNotMatch(serialized, /UNRELATED_CREDENTIAL/)
            return true
        }
    )
})

test('validation applies the production variant default', () => {
    const validated = validatePlaygroundEnvironment({
        EAS_PROJECT_ID: 'project-id',
    })

    assert.equal(validated.APP_VARIANT, 'production')
    assert.equal(validated.EAS_PROJECT_ID, 'project-id')
})

test('uses the public Playground EAS project when no override is supplied', () => {
    assert.equal(validatePlaygroundEnvironment({}).EAS_PROJECT_ID,
        'c1583cae-84c8-4071-b3ac-1e90a2fee815')
})
