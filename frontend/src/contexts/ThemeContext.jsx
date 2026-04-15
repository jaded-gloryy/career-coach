import { createContext, useContext, useEffect, useState } from 'react'

const ThemeContext = createContext()

export const THEMES = [
  { id: 'pink', label: 'Pink',  swatch: '#ec4899' },
  { id: 'blue', label: 'Blue',  swatch: '#3b82f6' },
  { id: 'gray', label: 'Gray',  swatch: '#737373' },
]

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => localStorage.getItem('cc-theme') || 'pink')

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('cc-theme', theme)
  }, [theme])

  return (
    <ThemeContext.Provider value={{ theme, setTheme, themes: THEMES }}>
      {children}
    </ThemeContext.Provider>
  )
}

export const useTheme = () => useContext(ThemeContext)
