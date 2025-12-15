export interface Indexer {
  id: number;
  name: string;
  protocol: IndexerProtocol;
  url: string;
  apiKey?: string;
  username?: string;
  password?: string;
  enabled: boolean;
  updateInterval: number;
  categories?: string;
  timeout: number;
  lastUpdated?: number;
  lastTested?: number;
  testStatus: TestStatus;
  testMessage?: string;
  createdAt: number;
  updatedAt: number;
}

export interface IndexerTest {
  id: number;
  indexerId: number;
  testType: TestType;
  status: TestStatus;
  message?: string;
  responseTimeMs?: number;
  testedAt: number;
}

export interface IndexerSearchRequest {
  query: string;
  categories?: number[];
  limit?: number;
}

export interface IndexerSearchResult {
  title: string;
  size: number;
  category: string;
  publishDate: string;
  link: string;
  magnet?: string;
  seeders?: number;
  leechers?: number;
  indexer: string;
  indexerId: number;
}

export interface TestResult {
  status: TestStatus;
  message: string;
  responseTimeMs: number;
}

export type IndexerProtocol = 'torznab';

export type TestType = 'connection' | 'search' | 'api_key';

export type TestStatus = 'success' | 'failed' | 'timeout' | 'unknown';

export interface IndexerFormData {
  name: string;
  protocol: IndexerProtocol;
  url: string;
  apiKey?: string;
  username?: string;
  password?: string;
  enabled: boolean;
  updateInterval: number;
  categories?: string;
  timeout: number;
}

export interface IndexerStats {
  total: number;
  enabled: number;
  disabled: number;
  lastTested: number;
  successfulTests: number;
  failedTests: number;
}

export const INDEXER_PROTOCOLS: { value: IndexerProtocol; label: string; description: string }[] = [
  {
    value: 'torznab',
    label: 'Indexer',
    description: 'Generic indexer configuration'
  }
];

export const TEST_TYPES: { value: TestType; label: string; description: string }[] = [
  {
    value: 'connection',
    label: 'Connection Test',
    description: 'Test basic connectivity to the indexer'
  },
  {
    value: 'search',
    label: 'Search Test',
    description: 'Test search functionality'
  },
  {
    value: 'api_key',
    label: 'API Key Test',
    description: 'Validate API key authentication'
  }
];

export const TEST_STATUS_COLORS: Record<TestStatus, string> = {
  success: '#4caf50',
  failed: '#f44336',
  timeout: '#ff9800',
  unknown: '#9e9e9e'
};

export const TEST_STATUS_LABELS: Record<TestStatus, string> = {
  success: 'Success',
  failed: 'Failed',
  timeout: 'Timeout',
  unknown: 'Unknown'
};

export const DEFAULT_INDEXER_CONFIG: Partial<IndexerFormData> = {
  enabled: true,
  updateInterval: 15,
  timeout: 30,
  protocol: 'torznab'
};

