/**
 * Typing the name of a room you already have.
 *
 * This is the only place in the app where a person creates a venue, and it
 * used to hand whatever was typed straight to `onCreate`. Nothing checked, so
 * "aria" on a night the chip said "Aria" produced a second room -- and from
 * then on the dashboard had two rows for one place, the venue breakdown split
 * the bankroll between them, and there was no way back, because a venue with a
 * session against it cannot be removed.
 *
 * The assertions are about what is not created. The visible half (the button
 * changing, the line appearing) is there so it does not read as the Add button
 * having been ignored, and it is worth one test; the half that matters is that
 * `onCreate` is never called.
 */

import { render, screen, userEvent } from '@testing-library/react-native';

import { VenuePicker } from '../VenuePicker';
import type { Venue } from '../../../domain/types';

const venue = (id: string, name: string): Venue => ({
  id,
  name,
  isHomeGame: false,
  sessionCount: 4,
  createdAt: 1,
  updatedAt: 1,
});

const VENUES = [venue('v1', 'Aria'), venue('v2', 'Bellagio')];

const mockCreated: string[] = [];
const mockChosen: string[] = [];

const show = (venues: readonly Venue[] = VENUES) =>
  render(
    <VenuePicker
      venues={venues}
      value={null}
      onChange={(id) => mockChosen.push(id)}
      onCreate={async (name) => {
        mockCreated.push(name);
        return venue('new', name);
      }}
    />,
  );

const type = async (text: string) => {
  await userEvent.press(screen.getByText('+ New venue'));
  await userEvent.type(screen.getByLabelText('New venue name'), text);
};

beforeEach(() => {
  mockCreated.length = 0;
  mockChosen.length = 0;
});

describe('a room that is already in the log', () => {
  it('is picked rather than created again, whatever the casing', async () => {
    await show();
    await type('aria');
    await userEvent.press(screen.getByText('Use it'));

    expect(mockCreated).toEqual([]);
    expect(mockChosen).toEqual(['v1']);
  });

  it('matches through the space a phone keyboard adds', async () => {
    await show();
    await type('Aria ');
    await userEvent.press(screen.getByText('Use it'));

    expect(mockCreated).toEqual([]);
    expect(mockChosen).toEqual(['v1']);
  });

  it('says so before the button is pressed, so the button is not a surprise', async () => {
    await show();
    await type('ARIA');
    expect(screen.getByText('Aria is already in your log.')).toBeTruthy();
    expect(screen.queryByText('Add')).toBeNull();
  });
});

describe('a room that is not', () => {
  it('is created, which is the ordinary path and is unchanged', async () => {
    await show();
    await type('Commerce');
    await userEvent.press(screen.getByText('Add'));

    expect(mockCreated).toEqual(['Commerce']);
    expect(mockChosen).toEqual(['new']);
  });

  it('is not confused with a room whose name merely starts the same way', async () => {
    // Two real rooms. Folding these would be a guess, and merging is the
    // player's own call in Settings.
    await show();
    await type('Aria High Limit');
    await userEvent.press(screen.getByText('Add'));

    expect(mockCreated).toEqual(['Aria High Limit']);
  });

  it('and the first venue in an empty log is still just created', async () => {
    await show([]);
    await userEvent.type(screen.getByLabelText('New venue name'), 'Aria');
    await userEvent.press(screen.getByText('Add'));

    expect(mockCreated).toEqual(['Aria']);
  });
});

describe('a venue that will not save', () => {
  it('says so, rather than stopping the spinner and leaving it at that', async () => {
    // There was no catch, so the write failed in the one way that looks like
    // success from a foot away: the spinner stopped, the typed name stayed,
    // and no chip appeared. Both call sites are `void submit()`, so it was an
    // unhandled rejection too. The player cannot start the session either,
    // because there is no venue id, and nothing on screen says why.
    await render(
      <VenuePicker
        venues={VENUES}
        value={null}
        onChange={(id) => mockChosen.push(id)}
        onCreate={async () => {
          throw new Error('The database is full.');
        }}
      />,
    );

    await userEvent.press(screen.getByText('+ New venue'));
    await userEvent.type(screen.getByLabelText('New venue name'), 'Bellagio Two');
    await userEvent.press(screen.getByText('Add'));

    expect(await screen.findByText('The database is full.')).toBeTruthy();
    expect(mockChosen).toEqual([]);
  });

  it('and clears the note once a different room is picked', async () => {
    // `matched` had the same shape of problem in the other direction: a note
    // about the last selection outlived the selection it described.
    await render(
      <VenuePicker
        venues={VENUES}
        value={null}
        onChange={(id) => mockChosen.push(id)}
        onCreate={async () => {
          throw new Error('The database is full.');
        }}
      />,
    );

    await userEvent.press(screen.getByText('+ New venue'));
    await userEvent.type(screen.getByLabelText('New venue name'), 'Bellagio Two');
    await userEvent.press(screen.getByText('Add'));
    await screen.findByText('The database is full.');

    await userEvent.press(screen.getByText('Cancel'));
    await userEvent.press(screen.getByText('Aria'));

    expect(screen.queryByText('The database is full.')).toBeNull();
    expect(mockChosen).toEqual(['v1']);
  });
});
