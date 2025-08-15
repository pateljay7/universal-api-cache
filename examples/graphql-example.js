const express = require('express');
const { graphqlHTTP } = require('express-graphql');
const { buildSchema } = require('graphql');
const { apiCache } = require('universal-api-cache');

// Sample GraphQL schema
const schema = buildSchema(`
  type User {
    id: ID!
    name: String!
    email: String!
  }

  type Post {
    id: ID!
    title: String!
    content: String!
    author: User!
  }

  type Query {
    user(id: ID!): User
    users: [User!]!
    post(id: ID!): Post
    posts: [Post!]!
  }

  type Mutation {
    createUser(name: String!, email: String!): User!
    updateUser(id: ID!, name: String, email: String): User!
    deleteUser(id: ID!): Boolean!
    createPost(title: String!, content: String!, authorId: ID!): Post!
  }
`);

// Sample data
const users = [
  { id: '1', name: 'John Doe', email: 'john@example.com' },
  { id: '2', name: 'Jane Smith', email: 'jane@example.com' },
];

const posts = [
  { id: '1', title: 'First Post', content: 'Hello World!', authorId: '1' },
  { id: '2', title: 'Second Post', content: 'GraphQL is awesome!', authorId: '2' },
];

// Resolvers
const root = {
  user: ({ id }) => users.find(u => u.id === id),
  users: () => users,
  post: ({ id }) => posts.find(p => p.id === id),
  posts: () => posts.map(post => ({
    ...post,
    author: users.find(u => u.id === post.authorId)
  })),
  
  // Mutations
  createUser: ({ name, email }) => {
    const newUser = { id: String(users.length + 1), name, email };
    users.push(newUser);
    return newUser;
  },
  
  updateUser: ({ id, name, email }) => {
    const user = users.find(u => u.id === id);
    if (!user) throw new Error('User not found');
    if (name) user.name = name;
    if (email) user.email = email;
    return user;
  },
  
  deleteUser: ({ id }) => {
    const index = users.findIndex(u => u.id === id);
    if (index === -1) return false;
    users.splice(index, 1);
    return true;
  },
  
  createPost: ({ title, content, authorId }) => {
    const newPost = { 
      id: String(posts.length + 1), 
      title, 
      content, 
      authorId,
      author: users.find(u => u.id === authorId)
    };
    posts.push(newPost);
    return newPost;
  },
};

const app = express();

// Configure cache for GraphQL
const cache = apiCache({
  ttl: 300, // 5 minutes
  useMemory: true,
  useRedis: false,
  
  // GraphQL-specific options
  cacheIntrospection: true, // Cache introspection queries (useful for GraphQL playground)
  
  // Custom cache key generator for GraphQL operations
  graphQLKeyGenerator: (req) => {
    if (!req.body?.query) return undefined;
    
    const { query, variables, operationName } = req.body;
    const userId = req.user?.id || 'anonymous';
    
    // Extract operation name from query if not provided
    const opName = operationName || extractOperationName(query);
    
    // Create deterministic key based on operation and variables
    const variablesStr = variables ? JSON.stringify(variables) : '';
    return `graphql:${opName}:${variablesStr}:${userId}`;
  },
  
  // Custom invalidation patterns for mutations
  getInvalidationPatterns: (req) => {
    if (!req.body?.query) return [];
    
    const query = req.body.query.trim();
    const userId = req.user?.id || 'anonymous';
    
    // Define which queries should be invalidated for each mutation
    if (query.includes('createUser') || query.includes('updateUser') || query.includes('deleteUser')) {
      return [
        `graphql:users:*:${userId}`,
        `graphql:user:*:${userId}`,
      ];
    }
    
    if (query.includes('createPost')) {
      return [
        `graphql:posts:*:${userId}`,
        `graphql:post:*:${userId}`,
      ];
    }
    
    return [];
  },
  
  // Get user ID from request (for user-specific caching)
  getUserId: (req) => req.user?.id,
  
  // Per-operation TTL
  getPerRouteTtl: (req) => {
    if (!req.body?.query) return undefined;
    
    const query = req.body.query.trim();
    
    // Cache user data for longer
    if (query.includes('user') || query.includes('users')) {
      return 600; // 10 minutes
    }
    
    // Cache posts for shorter time
    if (query.includes('post') || query.includes('posts')) {
      return 180; // 3 minutes
    }
    
    return undefined; // Use default TTL
  },
  
  logger: {
    debug: console.log,
    info: console.log,
    warn: console.warn,
    error: console.error,
  }
});

// Helper function to extract operation name from GraphQL query
function extractOperationName(query) {
  const match = query.match(/(?:query|mutation)\s+([A-Za-z_][A-Za-z0-9_]*)/);
  return match ? match[1] : 'unnamed';
}

// Add body parser for GraphQL
app.use(express.json());

// Add mock authentication middleware
app.use((req, res, next) => {
  // In a real app, this would verify JWT or session
  const userId = req.headers['x-user-id'];
  if (userId) {
    req.user = { id: userId };
  }
  next();
});

// Apply caching middleware to GraphQL endpoint
app.use('/graphql', cache);

// GraphQL endpoint
app.use('/graphql', graphqlHTTP({
  schema: schema,
  rootValue: root,
  graphiql: true, // Enable GraphQL Playground
}));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok',
    cache: cache.getCacheStats()
  });
});

// Cache management endpoints
app.post('/cache/clear', (req, res) => {
  cache.clearCache();
  res.json({ message: 'Cache cleared' });
});

app.get('/cache/stats', (req, res) => {
  res.json(cache.getCacheStats());
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`GraphQL server running on http://localhost:${PORT}/graphql`);
  console.log(`GraphQL Playground available at http://localhost:${PORT}/graphql`);
  console.log(`Cache stats available at http://localhost:${PORT}/cache/stats`);
});

/* 
Example GraphQL queries to test caching:

1. Query (will be cached):
query GetUsers {
  users {
    id
    name
    email
  }
}

2. Query with variables (will be cached):
query GetUser($userId: ID!) {
  user(id: $userId) {
    id
    name
    email
  }
}

3. Mutation (will invalidate related caches):
mutation CreateUser($name: String!, $email: String!) {
  createUser(name: $name, email: $email) {
    id
    name
    email
  }
}

To test with user-specific caching, add header:
x-user-id: user123

Cache behavior:
- Queries are cached based on operation name, variables, and user ID
- Mutations invalidate related cached queries
- Introspection queries are cached (useful for GraphQL Playground)
- Different operations can have different TTLs
- User-specific caching ensures users only see their own cached data
*/
