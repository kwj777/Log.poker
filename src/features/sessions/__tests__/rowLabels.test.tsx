/**
 * What a screen reader is told about a row in a list.
 *
 * Both rows are one accessibility element: `Card` renders a `Pressable`, a
 * `Pressable` sets `accessible` unless it is told otherwise, and a label on
 * a grouped element is not a hint alongside its content -- it is the whole of
 * what is announced. Both rows carried a label naming one part of themselves,
 * so everything else they draw was silent.
 *
 * On the session row that meant the result, which its own docstring calls the
 * column a player's eye runs down: ten nights at one room announced as ten
 * identical rows. On the hand row it meant the note, which is the reason a
 * hand was written down at all -- under a comment claiming the note and the
 * tags "are read after it by the elements that hold them".
 *
 * So each test here asks what the one element is called, not what the row
 * contains. That distinction is the bug.
 */

import { render, screen } from '@testing-library/react-native';

import { HandRow } from '../HandRow';
import { SessionRow } from '../SessionRow';
import { session } from '../../../__tests__/support/sessions';
import type { Hand } from '../../../domain/types';

const nameOf = (): string => String(screen.getByRole('button').props.accessibilityLabel);

const hand = (over: Partial<Hand> = {}): Hand => ({
  id: 'h1',
  sessionId: 's1',
  holeCards: 'AsKd',
  board: '7c2sKh',
  position: 'BTN',
  note: 'flopped top pair',
  tags: ['bad_beat'],
  amount: 12_000,
  at: 1,
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

describe('a session in a list', () => {
  it('is announced with everything it draws, not just the room', async () => {
    await render(<SessionRow session={session('s1')} onPress={() => undefined} />);
    const name = nameOf();

    expect(name).toContain('Aria');
    // The three that were silent, and the result is the one that matters.
    expect(name).toContain('+$150');
    expect(name).toContain('4h 0m');
    expect(name).toContain('$1/$2 · NLHE');
  });

  it('says a live session is live, where a finished one gives its result', async () => {
    await render(
      <SessionRow session={session('s1', { endedAt: null, cashOut: null })} onPress={() => undefined} />,
    );
    const name = nameOf();
    expect(name).toContain('Live');
    expect(name).not.toContain('+$');
  });

  it('and is the same whether it is a row or a card on its own', async () => {
    // Two branches, one label. They were written out twice and are the kind of
    // pair that drifts, so they are drawn together and compared.
    await render(
      <>
        <SessionRow session={session('s1')} onPress={() => undefined} />
        <SessionRow session={session('s1')} standalone onPress={() => undefined} />
      </>,
    );
    const [inline, standalone] = screen
      .getAllByRole('button')
      .map((row) => String(row.props.accessibilityLabel));

    expect(standalone).toBe(inline);
    expect(inline).toContain('+$150');
  });
});

describe('a hand in a list', () => {
  it('is announced with the note, the runout, the tags and the money', async () => {
    await render(<HandRow hand={hand()} currency="USD" onPress={() => undefined} />);
    const name = nameOf();

    expect(name).toContain('A♠ K♦ from BTN');
    expect(name).toContain('flopped top pair');
    expect(name).toContain('7♣ 2♠ K♥');
    expect(name).toContain('bad beat');
    expect(name).toContain('+$120');
  });

  it('leaves out what the row leaves out, rather than announcing empties', async () => {
    await render(
      <HandRow
        hand={hand({ holeCards: null, position: null, board: null, note: null, tags: [], amount: null })}
        currency="USD"
        onPress={() => undefined}
      />,
    );
    // The row draws "No note" as placeholder text; a name that read it out
    // would be announcing the absence of content as content.
    expect(nameOf()).toBe('Hand with no cards. Opens the hand.');
  });

  it('and a hand with no press has no button to name at all', async () => {
    await render(<HandRow hand={hand()} currency="USD" />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
