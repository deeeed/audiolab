// Plain-Node Jest for unit tests that mock their React Native and Expo imports.
module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    roots: ['<rootDir>/src'],
}
