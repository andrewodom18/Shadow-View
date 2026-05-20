import {applyMiddleware, combineReducers, compose, createStore} from 'redux';
import {enhanceReduxMiddleware, keplerGlReducer} from '@kepler.gl/reducers';

const reducers = combineReducers({
  keplerGl: keplerGlReducer.initialState({
    uiState: {
      readOnly: false,
      activeSidePanel: '',
      currentModal: null
    }
  })
});

const middlewares = enhanceReduxMiddleware([]);
const enhancers = compose(applyMiddleware(...middlewares));

export const store = createStore(reducers, {}, enhancers);
