import React, { useRef, useState } from 'react'
import {
  ButtonGroup,
  Button,
  Popper,
  Paper,
  MenuList,
  MenuItem,
  ClickAwayListener,
  Grow,
  Typography,
} from '@mui/material'
import { ArrowDropDown } from '@mui/icons-material'
import type { MapStyleDef, MapStyleId } from '../config/mapProviders'

/**
 * Two-button map style selector: "Map: <provider>" | "Satellite: <provider>".
 * Clicking the label toggles between the two categories (remembering the
 * provider you used last in each). A small dropdown arrow appears next to
 * each label when more than one provider is available for that category.
 *
 * Ported from `AirQ-Sports/frontend/shared/src/components/mapgl/MapStyleSelector.jsx`.
 */
type Props = {
  mapStyle: MapStyleId
  setMapStyle: (id: MapStyleId) => void
  availableStyles: MapStyleDef[]
  streetsLabel?: string
  aerialLabel?: string
  size?: 'small' | 'medium' | 'large'
}

type Category = 'Streets' | 'Aerial'

export const MapStyleSelector: React.FC<Props> = ({
  mapStyle,
  setMapStyle,
  availableStyles,
  streetsLabel = 'Map',
  aerialLabel = 'Satellite',
  size = 'small',
}) => {
  const [openCat, setOpenCat] = useState<Category | null>(null)
  const streetsRef = useRef<HTMLButtonElement | null>(null)
  const aerialRef = useRef<HTMLButtonElement | null>(null)

  if (!availableStyles || availableStyles.length === 0) return null

  const streets = availableStyles.filter(s => s.category === 'Streets')
  const aerial = availableStyles.filter(s => s.category === 'Aerial')
  const currentDef = availableStyles.find(s => s.id === mapStyle)
  const isAerial = currentDef?.category === 'Aerial'

  // Remember the last pick per category so toggling doesn't lose the provider choice.
  const activeStreets = isAerial ? streets[0] : currentDef
  const activeAerial = isAerial ? currentDef : aerial[0]
  const streetsProvider = (activeStreets || streets[0])?.label || ''
  const aerialProvider = (activeAerial || aerial[0])?.label || ''

  const handleMainClick = (category: Category) => {
    const group = category === 'Streets' ? streets : aerial
    if (group.length === 0) return
    if ((category === 'Streets' && !isAerial) || (category === 'Aerial' && isAerial)) return
    const target = category === 'Streets' ? activeStreets : activeAerial
    setMapStyle((target?.id as MapStyleId) || group[0].id)
  }

  const handleArrowClick = (e: React.MouseEvent, category: Category) => {
    e.stopPropagation()
    setOpenCat(prev => (prev === category ? null : category))
  }

  const handleMenuSelect = (styleId: MapStyleId) => {
    setMapStyle(styleId)
    setOpenCat(null)
  }

  const handleClose = () => setOpenCat(null)

  const btnSx = { textTransform: 'none' as const, fontSize: '0.8125rem', lineHeight: 1.4 }

  // Child Typography spans default to `text.primary` (dark grey) which
  // reads as unreadable grey-on-blue when this selector is dropped into a
  // dark-themed app bar. Forcing `color: inherit` lets the Button's own
  // color (white in the app bar, theme default elsewhere) propagate through.
  const renderLabel = (category: string, provider: string) => (
    <>
      <Typography component="span" sx={{ fontSize: '0.7rem', opacity: 0.7, mr: 0.5, color: 'inherit' }}>{category}:</Typography>
      <Typography component="span" sx={{ fontSize: '0.8125rem', fontWeight: 500, color: 'inherit' }}>{provider}</Typography>
    </>
  )

  const renderDropdown = (category: Category, anchorRef: React.RefObject<HTMLButtonElement | null>, items: MapStyleDef[]) => (
    <Popper open={openCat === category} anchorEl={anchorRef.current} transition disablePortal placement="bottom-start" sx={{ zIndex: 1300 }}>
      {({ TransitionProps }) => (
        <Grow {...TransitionProps}>
          <Paper elevation={4} sx={{ mt: 0.5 }}>
            <ClickAwayListener onClickAway={handleClose}>
              <MenuList dense autoFocusItem={openCat === category}>
                {items.map(s => (
                  <MenuItem
                    key={s.id}
                    selected={s.id === mapStyle}
                    onClick={() => handleMenuSelect(s.id)}
                    sx={{ fontSize: '0.8125rem', minWidth: 140 }}
                  >
                    {s.label}
                  </MenuItem>
                ))}
              </MenuList>
            </ClickAwayListener>
          </Paper>
        </Grow>
      )}
    </Popper>
  )

  return (
    <>
      <ButtonGroup size={size} variant="outlined">
        <Button
          onClick={() => handleMainClick('Streets')}
          variant={!isAerial ? 'contained' : 'outlined'}
          sx={btnSx}
        >
          {renderLabel(streetsLabel, streetsProvider)}
        </Button>
        {streets.length > 1 && (
          <Button
            ref={streetsRef}
            variant={!isAerial ? 'contained' : 'outlined'}
            onClick={(e) => handleArrowClick(e, 'Streets')}
            sx={{ px: 0, minWidth: 28 }}
            aria-label="Choose streets provider"
          >
            <ArrowDropDown fontSize="small" />
          </Button>
        )}

        <Button
          onClick={() => handleMainClick('Aerial')}
          variant={isAerial ? 'contained' : 'outlined'}
          sx={btnSx}
        >
          {renderLabel(aerialLabel, aerialProvider)}
        </Button>
        {aerial.length > 1 && (
          <Button
            ref={aerialRef}
            variant={isAerial ? 'contained' : 'outlined'}
            onClick={(e) => handleArrowClick(e, 'Aerial')}
            sx={{ px: 0, minWidth: 28 }}
            aria-label="Choose satellite provider"
          >
            <ArrowDropDown fontSize="small" />
          </Button>
        )}
      </ButtonGroup>

      {streets.length > 1 && renderDropdown('Streets', streetsRef, streets)}
      {aerial.length > 1 && renderDropdown('Aerial', aerialRef, aerial)}
    </>
  )
}
