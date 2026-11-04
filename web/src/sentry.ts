// The parts of Sentry this app uses, in a module of their own: imported by name, the bundler
// leaves out the rest (replay, feedback, tracing), which the whole package would bring along
export { captureException, init } from "@sentry/react";
