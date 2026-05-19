import {applyMiddleware, combineReducers, compose, createStore} from 'redux';
import keplerGlReducer, {enhanceReduxMiddleware} from '@kepler.gl/reducers';

const reducers = combineReducers({
  keplerGl: keplerGlReducer.initialState({
    uiState: {
      readOnly: false,
      currentModal: null
    }
  })
});

const middlewares = enhanceReduxMiddleware([]);
const enhancers = compose(applyMiddleware(...middlewares));

export const store = createStore(reducers, {}, enhancers);

