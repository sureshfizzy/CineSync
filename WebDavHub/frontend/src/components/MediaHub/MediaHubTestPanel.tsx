import { useState } from 'react';
import axios from 'axios';

interface MediaHubTestPanelProps {
  className?: string;
}

export function MediaHubTestPanel({ className }: MediaHubTestPanelProps) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const sendTestMessage = async (type: string, data: any) => {
    setLoading(true);
    setMessage('');
    
    try {
      const response = await axios.post('/api/mediahub/message', {
        type,
        timestamp: Date.now() / 1000,
        data
      });
      
      if (response.status === 200) {
        setMessage(`✅ Test ${type} message sent successfully!`);
      } else {
        setMessage(`❌ Failed to send test message: ${response.status}`);
      }
    } catch (error) {
      setMessage(`❌ Error sending test message: ${error}`);
      console.error('Test message error:', error);
    } finally {
      setLoading(false);
    }
  };

  const testSymlinkCreated = () => {
    sendTestMessage('symlink_created', {
      media_name: 'Test Movie 2024',
      media_type: 'movie',
      destination_file: '/path/to/test/movie.mkv',
      filename: 'Test.Movie.2024.1080p.BluRay.x264.mkv',
      tmdb_id: 12345,
      source_file: '/source/test/movie.mkv',
      new_folder_name: 'Test Movie (2024)',
      new_filename: 'Test Movie (2024).mkv',
      timestamp: Date.now() / 1000
    });
  };

  const testTVShowSymlink = () => {
    sendTestMessage('symlink_created', {
      media_name: 'Test TV Show',
      media_type: 'tvshow',
      destination_file: '/path/to/test/tvshow/S01E01.mkv',
      filename: 'Test.TV.Show.S01E01.1080p.WEB-DL.x264.mkv',
      tmdb_id: 67890,
      season_number: 1,
      episode_number: 1,
      show_name: 'Test TV Show',
      episode_title: 'Pilot Episode',
      source_file: '/source/test/tvshow/episode.mkv',
      new_folder_name: 'Test TV Show',
      new_filename: 'S01E01 - Pilot Episode.mkv',
      timestamp: Date.now() / 1000
    });
  };

  const testFileProcessed = () => {
    sendTestMessage('file_processed', {
      filename: 'Another.Test.File.2024.mkv',
      status: 'success',
      message: 'File processed successfully'
    });
  };

  const testScanStarted = () => {
    sendTestMessage('scan_started', {
      directory: '/source/movies',
      message: 'Starting directory scan'
    });
  };

  const testError = () => {
    sendTestMessage('error', {
      message: 'Test error message',
      filename: 'problematic.file.mkv',
      error_type: 'processing_error'
    });
  };

  return (
    <div className={`bg-white dark:bg-gray-800 rounded-lg shadow p-6 ${className || ''}`}>
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
        MediaHub SSE Test Panel
      </h3>
      
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
        Use these buttons to test real-time MediaHub updates. Check the MediaHub Activity component to see the events appear in real-time.
      </p>

      {message && (
        <div className={`mb-4 p-3 rounded-md ${
          message.includes('✅') 
            ? 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200' 
            : 'bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200'
        }`}>
          {message}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <button
          onClick={testSymlinkCreated}
          disabled={loading}
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm"
        >
          {loading ? 'Sending...' : 'Test Movie Symlink'}
        </button>

        <button
          onClick={testTVShowSymlink}
          disabled={loading}
          className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm"
        >
          {loading ? 'Sending...' : 'Test TV Show Symlink'}
        </button>

        <button
          onClick={testFileProcessed}
          disabled={loading}
          className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm"
        >
          {loading ? 'Sending...' : 'Test File Processed'}
        </button>

        <button
          onClick={testScanStarted}
          disabled={loading}
          className="px-4 py-2 bg-yellow-600 text-white rounded-md hover:bg-yellow-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm"
        >
          {loading ? 'Sending...' : 'Test Scan Started'}
        </button>

        <button
          onClick={testError}
          disabled={loading}
          className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm"
        >
          {loading ? 'Sending...' : 'Test Error'}
        </button>
      </div>

      <div className="mt-4 p-3 bg-gray-100 dark:bg-gray-700 rounded-md">
        <p className="text-xs text-gray-600 dark:text-gray-400">
          <strong>Note:</strong> These are test messages only. They will trigger real-time updates in the UI but won't create actual files or symlinks.
        </p>
      </div>
    </div>
  );
}
