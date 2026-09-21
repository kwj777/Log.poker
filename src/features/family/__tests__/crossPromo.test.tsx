/**
 * "More from the family", rendered.
 *
 * Every screen that holds this card mocks it away to `() => null`, which is
 * right for those files and left this one never rendered by anything: the row
 * a player taps, the app it excludes, and the link it opens were all only ever
 * read as source.
 */

import { render, screen, userEvent } from '@testing-library/react-native';
import { Linking } from 'react-native';

import { FamilyCrossPromo } from '../FamilyCrossPromo';
import { FAMILY_LINKS } from '../../../config';

let opened: string[] = [];

beforeEach(() => {
  opened = [];
  jest.spyOn(Linking, 'openURL').mockImplementation(async (url: string) => {
    opened.push(url);
    return true;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('the family card', () => {
  it('offers all three when nothing is excluded', async () => {
    await render(<FamilyCrossPromo />);
    expect(screen.getByLabelText('Open Log')).toBeTruthy();
    expect(screen.getByLabelText('Open Untilt.poker')).toBeTruthy();
    expect(screen.getByLabelText('Open TiltProof')).toBeTruthy();
  });

  it('leaves out the app the player is already in', async () => {
    await render(<FamilyCrossPromo exclude={['log']} />);
    expect(screen.queryByLabelText('Open Log')).toBeNull();
    expect(screen.getByLabelText('Open Untilt.poker')).toBeTruthy();
  });

  it('and draws nothing at all rather than an empty heading', async () => {
    await render(<FamilyCrossPromo exclude={['log', 'untilt', 'tiltproof']} />);
    expect(screen.queryByText('More from the family')).toBeNull();
  });

  it('opens the address the config names, rather than one typed here', async () => {
    await render(<FamilyCrossPromo />);
    await userEvent.press(screen.getByLabelText('Open Untilt.poker'));
    expect(opened).toEqual([FAMILY_LINKS.untilt]);
  });

  it('and survives a device that will not open it', async () => {
    // A blocked pop-up or no default browser, which is the case the helper's
    // catch is written for. This row called `openURL` bare, so the rejection
    // had nowhere to go. Jest fails the test on an unhandled one.
    jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('no handler'));
    await render(<FamilyCrossPromo />);

    await userEvent.press(screen.getByLabelText('Open TiltProof'));
    await new Promise((resolve) => setImmediate(resolve));

    expect(screen.getByText('More from the family')).toBeTruthy();
  });
});
