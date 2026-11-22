import * as React from 'react';
import renderer, { act, type ReactTestRenderer } from 'react-test-renderer';

import { ThemedText } from '../ThemedText';

it(`renders correctly`, () => {
  // React 19.3's test renderer always uses a concurrent root, so rendering needs act().
  let tree!: ReactTestRenderer;
  act(() => {
    tree = renderer.create(<ThemedText>Snapshot test!</ThemedText>);
  });

  expect(tree.toJSON()).toMatchSnapshot();
});
