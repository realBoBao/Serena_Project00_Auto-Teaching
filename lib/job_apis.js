/**
 * lib/job_apis.js — Free Job APIs (No auth required)
 * 
 * Sources:
 * - AI Dev Jobs: AI/ML engineering jobs
 * - Arbeitnow: Remote jobs in Europe
 * - GraphQL Jobs: GraphQL-based job search
 * 
 * Usage:
 *   import { fetchAIDevJobs, fetchArbeitnowJobs, fetchGraphQLJobs } from './lib/job_apis.js';
 */

/**
 * Fetch AI Dev Jobs (REST + RSS)
 * https://aidevboard.com/openapi.yaml
 */
export async function fetchAIDevJobs(limit = 10) {
  try {
    const res = await fetch('https://api.aidevboard.com/v1/jobs', {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const jobs = Array.isArray(data) ? data : (data.jobs || data.data || []);
    return jobs.slice(0, limit).map(j => ({
      id: j.id || `ai-${Buffer.from(j.url || j.title).toString('base64').slice(0, 8)}`,
      title: j.title || 'Unknown',
      company: j.company || 'Unknown',
      url: j.url || '#',
      location: j.location || 'Remote',
      source: 'AIDevJobs',
      tags: (j.tags || []).map(t => t.toLowerCase()),
      posted_date: j.date || new Date().toISOString(),
    }));
  } catch (err) {
    console.warn('[AIDevJobs] Fetch failed:', err.message);
    return [];
  }
}

/**
 * Fetch Arbeitnow Jobs (100% Free, No auth)
 * https://arbeitnow.com/api/job-board-api
 */
export async function fetchArbeitnowJobs(limit = 10) {
  try {
    const res = await fetch('https://arbeitnow.com/api/job-board-api', {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const jobs = data.data || [];
    return jobs.slice(0, limit).map(j => ({
      id: j.id || `arbe-${Buffer.from(j.url || j.title).toString('base64').slice(0, 8)}`,
      title: j.title || 'Unknown',
      company: j.company_name || 'Unknown',
      url: j.url || '#',
      location: j.location || (j.remote ? 'Remote' : 'Unknown'),
      source: 'Arbeitnow',
      tags: (j.tags || []).map(t => t.toLowerCase()),
      posted_date: j.published_at || new Date().toISOString(),
    }));
  } catch (err) {
    console.warn('[Arbeitnow] Fetch failed:', err.message);
    return [];
  }
}

/**
 * Fetch GraphQL Jobs (Free, GraphQL-based)
 * https://graphql.jobs/docs/api/
 */
export async function fetchGraphQLJobs(query = 'backend', limit = 10) {
  try {
    const graphqlQuery = `{
      jobs(query: "${query}", limit: ${limit}) {
        id
        title
        company { name }
        location { city country }
        url
        tags
        postedAt
      }
    }`;

    const res = await fetch('https://api.graphql.jobs/v1/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: graphqlQuery }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const jobs = data?.data?.jobs || [];
    return jobs.map(j => ({
      id: j.id || `gql-${Buffer.from(j.url || j.title).toString('base64').slice(0, 8)}`,
      title: j.title || 'Unknown',
      company: j.company?.name || 'Unknown',
      url: j.url || '#',
      location: j.location ? `${j.location.city || ''}, ${j.location.country || ''}`.trim() : 'Remote',
      source: 'GraphQLJobs',
      tags: (j.tags || []).map(t => t.toLowerCase()),
      posted_date: j.postedAt || new Date().toISOString(),
    }));
  } catch (err) {
    console.warn('[GraphQLJobs] Fetch failed:', err.message);
    return [];
  }
}

/**
 * Fetch all free job sources
 */
export async function fetchAllFreeJobs(limitPerSource = 5) {
  const [aiJobs, arbeJobs, gqlJobs] = await Promise.allSettled([
    fetchAIDevJobs(limitPerSource),
    fetchArbeitnowJobs(limitPerSource),
    fetchGraphQLJobs('backend', limitPerSource),
  ]);

  return {
    ai: aiJobs.status === 'fulfilled' ? aiJobs.value : [],
    arbeitnow: arbeJobs.status === 'fulfilled' ? arbeJobs.value : [],
    graphql: gqlJobs.status === 'fulfilled' ? gqlJobs.value : [],
  };
}

export default { fetchAIDevJobs, fetchArbeitnowJobs, fetchGraphQLJobs, fetchAllFreeJobs };
