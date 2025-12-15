import { Indexer, IndexerSearchRequest, IndexerSearchResult, TestResult, IndexerFormData } from '../types/indexer';

const API_BASE = '/api';

export class IndexerApi {
  // Get all indexers
  static async getIndexers(): Promise<Indexer[]> {
    const response = await fetch(`${API_BASE}/indexers`);
    if (!response.ok) {
      throw new Error(`Failed to fetch indexers: ${response.statusText}`);
    }
    return response.json();
  }

  // Get a specific indexer by ID
  static async getIndexer(id: number): Promise<Indexer> {
    const response = await fetch(`${API_BASE}/indexers/${id}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch indexer: ${response.statusText}`);
    }
    return response.json();
  }

  // Create a new indexer
  static async createIndexer(indexer: IndexerFormData): Promise<Indexer> {
    const response = await fetch(`${API_BASE}/indexers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(indexer),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ message: 'Failed to create indexer' }));
      throw new Error(errorData.message || `HTTP ${response.status}`);
    }

    return response.json();
  }

  // Update an existing indexer
  static async updateIndexer(id: number, indexer: IndexerFormData): Promise<Indexer> {
    const response = await fetch(`${API_BASE}/indexers/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(indexer),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ message: 'Failed to update indexer' }));
      throw new Error(errorData.message || `HTTP ${response.status}`);
    }

    return response.json();
  }

  // Delete an indexer
  static async deleteIndexer(id: number): Promise<void> {
    const response = await fetch(`${API_BASE}/indexers/${id}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ message: 'Failed to delete indexer' }));
      throw new Error(errorData.message || `HTTP ${response.status}`);
    }
  }

  // Test an indexer connection
  static async testIndexer(id: number): Promise<TestResult> {
    const response = await fetch(`${API_BASE}/indexers/${id}/test`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ message: 'Failed to test indexer' }));
      throw new Error(errorData.message || `HTTP ${response.status}`);
    }

    return response.json();
  }

  // Test an indexer configuration without saving
  static async testIndexerConfig(config: IndexerFormData): Promise<TestResult> {
    const response = await fetch(`${API_BASE}/indexers/test-config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(config),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ message: 'Failed to test indexer config' }));
      throw new Error(errorData.message || `HTTP ${response.status}`);
    }

    return response.json();
  }

  // Search through an indexer
  static async searchIndexer(id: number, searchRequest: IndexerSearchRequest): Promise<IndexerSearchResult[]> {
    const response = await fetch(`${API_BASE}/indexers/${id}/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(searchRequest),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ message: 'Failed to search indexer' }));
      throw new Error(errorData.message || `HTTP ${response.status}`);
    }

    return response.json();
  }

  // Validate indexer configuration
  static validateIndexer(indexer: IndexerFormData): string[] {
    const errors: string[] = [];

    if (!indexer.name?.trim()) {
      errors.push('Name is required');
    }

    if (!indexer.protocol) {
      errors.push('Protocol is required');
    }

    if (!indexer.url?.trim()) {
      errors.push('URL is required');
    } else {
      try {
        new URL(indexer.url);
      } catch {
        errors.push('Invalid URL format');
      }
    }

    if (indexer.updateInterval && (indexer.updateInterval < 1 || indexer.updateInterval > 1440)) {
      errors.push('Update interval must be between 1 and 1440 minutes');
    }

    if (indexer.timeout && (indexer.timeout < 5 || indexer.timeout > 300)) {
      errors.push('Timeout must be between 5 and 300 seconds');
    }

    return errors;
  }

  // Format indexer URL for display
  static formatIndexerUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      return `${urlObj.protocol}//${urlObj.host}${urlObj.pathname}`;
    } catch {
      return url;
    }
  }

  // Get protocol display name
  static getProtocolDisplayName(protocol: string): string {
    const protocolMap: Record<string, string> = {
      torznab: 'Torznab',
      jackett: 'Jackett',
      prowlarr: 'Prowlarr',
      custom: 'Custom'
    };
    return protocolMap[protocol] || protocol;
  }

  // Format file size
  static formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  // Format date
  static formatDate(timestamp: number): string {
    return new Date(timestamp * 1000).toLocaleString();
  }

  // Get relative time
  static getRelativeTime(timestamp: number): string {
    const now = Date.now() / 1000;
    const diff = now - timestamp;
    
    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)} minutes ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} hours ago`;
    if (diff < 2592000) return `${Math.floor(diff / 86400)} days ago`;
    
    return new Date(timestamp * 1000).toLocaleDateString();
  }
}
