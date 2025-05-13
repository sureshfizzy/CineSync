export interface TMDbGenre {
  id: number;
  name: string;
}

export interface TMDbDetails {
  id: number;
  title?: string;
  name?: string;
  overview: string;
  poster_path: string;
  release_date?: string;
  first_air_date?: string;
  genres?: TMDbGenre[];
  media_type: 'movie' | 'tv';
  vote_average: number;
  vote_count: number;
} 