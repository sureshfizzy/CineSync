import { List, ListItemButton, ListItemIcon, ListItemText, Box, Typography, alpha } from '@mui/material';
import MovieIcon from '@mui/icons-material/Movie';
import TvIcon from '@mui/icons-material/Tv';
import { useEffect, useState } from 'react';

export default function ArrSidebar() {
	const getInitial = (): 'all' | 'movies' | 'series' => {
		const saved = localStorage.getItem('arrSidebarFilter');
		return saved === 'movies' || saved === 'series' ? saved : 'all';
	};
	const [filter, setFilter] = useState<'all' | 'movies' | 'series'>(getInitial);

	useEffect(() => {
		localStorage.setItem('arrSidebarFilter', filter);
		window.dispatchEvent(new CustomEvent('arrSidebarFilterChanged', { detail: { filter } }));
	}, [filter]);

	const handleClick = (value: 'movies' | 'series') => {
		setFilter(value);
	};

	return (
		<Box sx={{ p: 1 }}>
			<List dense disablePadding>
				<ListItemButton selected={filter === 'movies'} onClick={() => handleClick('movies')} sx={{ borderRadius: 1, mx: 0.5, mb: 0.5, '&.Mui-selected': { bgcolor: (t) => alpha(t.palette.primary.main, 0.12) } }}>
					<ListItemIcon sx={{ minWidth: 34 }}><MovieIcon fontSize="small" /></ListItemIcon>
					<ListItemText primary={<Typography variant="body2" fontWeight={700}>Movies</Typography>} />
				</ListItemButton>
				<ListItemButton selected={filter === 'series'} onClick={() => handleClick('series')} sx={{ borderRadius: 1, mx: 0.5, mb: 0.5, '&.Mui-selected': { bgcolor: (t) => alpha(t.palette.primary.main, 0.12) } }}>
					<ListItemIcon sx={{ minWidth: 34 }}><TvIcon fontSize="small" /></ListItemIcon>
					<ListItemText primary={<Typography variant="body2" fontWeight={700}>Series</Typography>} />
				</ListItemButton>
			</List>
		</Box>
	);
}
