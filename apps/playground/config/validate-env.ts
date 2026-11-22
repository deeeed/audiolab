import Joi from 'joi'

export type PlaygroundEnvironment = Record<string, string | undefined> & {
    APP_VARIANT: 'development' | 'staging' | 'production'
    EAS_PROJECT_ID: string
}

const envSchema = Joi.object({
    EAS_PROJECT_ID: Joi.string().default('c1583cae-84c8-4071-b3ac-1e90a2fee815'),
    APPLE_TEAM_ID: Joi.string().optional(),
    APP_VARIANT: Joi.string()
        .valid('development', 'staging', 'production')
        .default('production'),
}).unknown()

export function validatePlaygroundEnvironment(
    input: Record<string, string | undefined>
): PlaygroundEnvironment {
    const { error, value } = envSchema.validate(input, {
        abortEarly: false,
        stripUnknown: false,
    })

    if (error) {
        const invalidKeys = [
            ...new Set(
                error.details.map((detail) =>
                    detail.path.length > 0
                        ? detail.path.join('.')
                        : 'environment'
                )
            ),
        ].sort((left, right) => left.localeCompare(right))
        throw new Error(
            `Invalid environment variables: ${invalidKeys.join(', ')}`
        )
    }

    return value as PlaygroundEnvironment
}
