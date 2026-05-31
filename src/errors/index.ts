// errors/index.ts -- public error-class exports.

export {
  RainDBBoltError,
  CapabilityDenied,
  BindingNotInstalled,
  TokenExists,
  TokenExpired,
  ConditionFailed,
  StatsValidation,
  AuthorRequired,
} from './classes.js';

export {
  translateBindingError,
  type TranslateContext,
} from './from-binding.js';
