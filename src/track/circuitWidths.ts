/** Representative racing widths in metres, rather than the 8–12 m values
 * chosen to fit the old compressed layouts. Width still varies in real life;
 * this single-width road model is not a surveyed road-edge reconstruction.
 * See docs/circuit-terrain.md for published references and approximations. */
export const CIRCUIT_WIDTHS: Readonly<Record<string, number>> = {
  'world-bh-2002':16,'world-sa-2021':15,'world-au-1953':13,'world-jp-1962':13,
  'world-cn-2004':15,'world-us-2022':15,'world-it-1953':12,'world-mc-1929':10,
  'world-ca-1978':12,'world-es-1991':13,'world-at-1969':13,'world-gb-1948':15,
  'world-hu-1986':12,'world-be-1925':12,'world-nl-1948':13,'world-it-1922':12,
  'world-az-2016':12,'world-sg-2008':13,'world-us-2012':15,'world-mx-1962':14,
  'world-br-1940':13,'world-us-2023':15,'world-qa-2004':14,'world-ae-2009':15,
  'world-pt-2008':14,'world-tr-2005':15,'world-my-1999':16,'world-de-1932':13,
  'world-de-1927':13,'world-it-1914':12,
};
