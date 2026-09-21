/**
 * Two numbers on screen, and whether they are the two that will be saved.
 *
 * The picker holds its fields in their own state, which it has to: half-typed
 * input is the point, and a field reading "1." must not briefly write $1/$0
 * into the session. What it must not do is let those fields drift from the
 * stakes actually held, and it did, in the quietest way available. Neither
 * chip touched them, so a preset left the fields on the blinds they had
 * before it and Custom put those back on screen over stakes that were
 * something else.
 *
 * The visible half of that is bad enough. The half that costs a player money
 * is the next keystroke: each field commits itself alongside the other field's
 * current text, so correcting one blind wrote the stale other one into the
 * session with it, and both numbers on screen looked right afterwards.
 */

import { useState } from 'react';
import { render, screen, userEvent } from '@testing-library/react-native';

import { StakesPicker } from '../StakesPicker';
import type { Stakes } from '../../../domain/types';

const committed: Stakes[] = [];

/**
 * Held in state and handed back, which is what the two screens using this
 * picker do: `new.tsx` and `edit.tsx` both keep the stakes on their form and
 * pass them down again. A fixture that pins `value` would be testing a caller
 * this app does not have.
 */
const Harness = ({ initial }: { initial: Stakes }) => {
  const [stakes, setStakes] = useState(initial);
  return (
    <StakesPicker
      value={stakes}
      onChange={(next) => {
        committed.push(next);
        setStakes(next);
      }}
    />
  );
};

const show = (value: Stakes) => {
  committed.length = 0;
  return render(<Harness initial={value} />);
};

/** What the picker last said the stakes are. */
const last = (): Stakes | undefined => committed[committed.length - 1];

const fields = () => ({
  small: screen.getByLabelText('Small blind').props.value,
  big: screen.getByLabelText('Big blind').props.value,
});

describe('a session that opens on custom blinds', () => {
  it('shows the blinds it was given', async () => {
    await show({ smallBlind: 300, bigBlind: 500 });
    expect(fields()).toEqual({ small: '3', big: '5' });
  });

  it('moves the fields with the chip when a preset is tapped', async () => {
    await show({ smallBlind: 300, bigBlind: 500 });
    await userEvent.press(screen.getByText('$1/$2'));
    expect(last()).toMatchObject({ smallBlind: 100, bigBlind: 200 });

    // The fields went with it. They used to sit on 3 and 5 behind the chip,
    // so the next tap on Custom showed stakes nobody was holding.
    await userEvent.press(screen.getByText('Custom'));
    expect(fields()).toEqual({ small: '1', big: '2' });
  });

  it('saves the pair on screen, not the one a field is still remembering', async () => {
    // The whole finding. From $3/$5, take the $1/$2 chip, go back to Custom
    // and correct only the big blind to 10. That is $1/$10; it saved $3/$10.
    await show({ smallBlind: 300, bigBlind: 500 });
    await userEvent.press(screen.getByText('$1/$2'));
    await userEvent.press(screen.getByText('Custom'));

    const big = screen.getByLabelText('Big blind');
    await userEvent.clear(big);
    await userEvent.type(big, '10');

    expect(last()).toMatchObject({ smallBlind: 100, bigBlind: 1_000 });
  });
});

describe('a session that opens on a preset', () => {
  it('seeds the custom fields from the stakes it is holding', async () => {
    await show({ smallBlind: 200, bigBlind: 500 });
    await userEvent.press(screen.getByText('Custom'));
    expect(fields()).toEqual({ small: '2', big: '5' });
  });

  it('leaves the stakes alone until something is actually typed', async () => {
    await show({ smallBlind: 200, bigBlind: 500 });
    await userEvent.press(screen.getByText('Custom'));
    expect(committed).toEqual([]);
  });
});
