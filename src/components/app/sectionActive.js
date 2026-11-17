/* Whether the section a component is in is the one on screen (17 Nov 2026, the app frame in App.jsx). The tab
   bar's sections stay mounted while another shows, so a page that animates, polls or writes the address can ask
   this and rest while it is out of sight. Outside a section (a page opened from More) it is always true. */
import { createContext, useContext } from 'react';

export const SectionActiveContext = createContext(true);
export const useSectionActive = () => useContext(SectionActiveContext);
