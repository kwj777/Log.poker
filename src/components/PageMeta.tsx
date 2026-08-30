/**
 * Per-screen document metadata.
 *
 * Expo Router manages the document head through react-helmet, which renders its
 * own `<title>` element ahead of anything written in `+html.tsx`. `document.title`
 * resolves to the *first* title in the head, so a static title in the shell is
 * silently overridden by helmet's empty one — the browser tab ends up blank.
 * Setting it here is what actually reaches the tab, the bookmark and the
 * pre-rendered HTML.
 */

import Head from 'expo-router/head';

interface PageMetaProps {
  title: string;
  description?: string;
}

export const PageMeta = ({ title, description }: PageMetaProps) => (
  <Head>
    <title>{title}</title>
    {description === undefined ? null : <meta name="description" content={description} />}
  </Head>
);

export const APP_DESCRIPTION =
  'A poker session tracker and hand journal for live cash game and home game players. Log sessions in seconds, track your true hourly rate, and see whether a rough stretch is really outside normal variance.';
