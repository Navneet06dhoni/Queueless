module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  globalSetup: '<rootDir>/tests/globalSetup.ts',
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.test.json' }]
  },
  moduleFileExtensions: ['ts', 'js', 'json', 'node'],
  verbose: true,
  testTimeout: 30000
};
