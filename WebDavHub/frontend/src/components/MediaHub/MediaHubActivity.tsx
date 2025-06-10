import { useState, useEffect } from 'react';
import { useMediaHubUpdates, useSymlinkCreatedListener } from '../../hooks/useMediaHubUpdates';

interface ActivityItem {
  id: string;
  type: string;
  message: string;
  timestamp: number;
  data?: any;
}

interface MediaHubActivityProps {
  maxItems?: number;
  showConnectionStatus?: boolean;
}

export function MediaHubActivity({ 
  maxItems = 10, 
  showConnectionStatus = true 
}: MediaHubActivityProps) {
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const { isConnected, lastEvent, connectionError } = useMediaHubUpdates();

  // Listen for symlink creation events
  useSymlinkCreatedListener((data) => {
    const mediaName = data.media_name || 'Unknown Media';
    const mediaType = data.media_type || 'unknown';
    const filename = data.filename || data.new_filename || 'Unknown File';
    
    const message = `Created symlink for ${mediaType === 'tvshow' ? 'TV Show' : 'Movie'}: ${mediaName} (${filename})`;
    
    addActivity({
      id: `symlink_${Date.now()}_${Math.random()}`,
      type: 'symlink_created',
      message,
      timestamp: Date.now(),
      data
    });
  }, []);

  // Listen for all other MediaHub events
  useEffect(() => {
    if (lastEvent && lastEvent.type !== 'symlink_created' && lastEvent.type !== 'connected') {
      const message = formatEventMessage(lastEvent.type, lastEvent.data);
      
      addActivity({
        id: `${lastEvent.type}_${lastEvent.timestamp}_${Math.random()}`,
        type: lastEvent.type,
        message,
        timestamp: lastEvent.timestamp * 1000, // Convert to milliseconds
        data: lastEvent.data
      });
    }
  }, [lastEvent]);

  const addActivity = (activity: ActivityItem) => {
    setActivities(prev => {
      const newActivities = [activity, ...prev];
      return newActivities.slice(0, maxItems);
    });
  };

  const formatEventMessage = (type: string, data: any): string => {
    switch (type) {
      case 'file_processed':
        return `Processed file: ${data.filename || 'Unknown'}`;
      case 'scan_started':
        return `Directory scan started (${data.scanType || 'manual'})`;
      case 'scan_completed':
        return `Directory scan completed: ${data.totalFiles || 0} total, ${data.filesDiscovered || 0} discovered, ${data.filesUpdated || 0} updated, ${data.filesRemoved || 0} removed`;
      case 'scan_failed':
        return `Directory scan failed: ${data.error || 'Unknown error'}`;
      case 'error':
        return `Error: ${data.message || 'Unknown error'}`;
      case 'monitor_started':
        return 'Real-time monitoring started';
      case 'monitor_stopped':
        return 'Real-time monitoring stopped';
      default:
        return `${type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}: ${data.message || 'Event occurred'}`;
    }
  };

  const formatTimestamp = (timestamp: number): string => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    
    return date.toLocaleDateString();
  };

  const getActivityIcon = (type: string): string => {
    switch (type) {
      case 'symlink_created':
        return '🔗';
      case 'file_processed':
        return '📁';
      case 'scan_started':
      case 'scan_completed':
        return '🔍';
      case 'scan_failed':
      case 'error':
        return '❌';
      case 'monitor_started':
      case 'monitor_stopped':
        return '👁️';
      default:
        return '📋';
    }
  };

  const getActivityColor = (type: string): string => {
    switch (type) {
      case 'symlink_created':
        return 'text-green-600 dark:text-green-400';
      case 'scan_failed':
      case 'error':
        return 'text-red-600 dark:text-red-400';
      case 'scan_started':
      case 'monitor_started':
        return 'text-blue-600 dark:text-blue-400';
      case 'scan_completed':
      case 'monitor_stopped':
        return 'text-gray-600 dark:text-gray-400';
      default:
        return 'text-gray-700 dark:text-gray-300';
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
          MediaHub Activity
        </h3>
        {showConnectionStatus && (
          <div className="flex items-center space-x-2">
            <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`}></div>
            <span className="text-sm text-gray-600 dark:text-gray-400">
              {isConnected ? 'Connected' : 'Disconnected'}
            </span>
          </div>
        )}
      </div>

      {connectionError && (
        <div className="mb-4 p-3 bg-yellow-100 dark:bg-yellow-900 border border-yellow-300 dark:border-yellow-700 rounded-md">
          <p className="text-sm text-yellow-800 dark:text-yellow-200">{connectionError}</p>
        </div>
      )}

      <div className="space-y-3">
        {activities.length === 0 ? (
          <div className="text-center py-8">
            <div className="text-gray-400 dark:text-gray-600 text-4xl mb-2">📡</div>
            <p className="text-gray-500 dark:text-gray-400">
              {isConnected ? 'Waiting for MediaHub activity...' : 'Connecting to MediaHub...'}
            </p>
          </div>
        ) : (
          activities.map((activity) => (
            <div
              key={activity.id}
              className="flex items-start space-x-3 p-3 bg-gray-50 dark:bg-gray-700 rounded-md hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
            >
              <span className="text-lg flex-shrink-0 mt-0.5">
                {getActivityIcon(activity.type)}
              </span>
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium ${getActivityColor(activity.type)}`}>
                  {activity.message}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {formatTimestamp(activity.timestamp)}
                </p>
              </div>
            </div>
          ))
        )}
      </div>

      {activities.length > 0 && (
        <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={() => setActivities([])}
            className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
          >
            Clear activity
          </button>
        </div>
      )}
    </div>
  );
}
