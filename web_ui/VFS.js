class VirtualFileSystem {
  constructor() {
    // Primary storage - flat structure for O(1) lookups
    this.nodes = new Map(); // id -> node

    // Index structures for performance
    this.childrenIndex = new Map(); // parentId -> Set of childIds
    this.pathCache = new Map(); // id -> cached path array

    // Optional: for even faster operations
    this.typeIndex = new Map(); // type -> Set of ids
    this.nameIndex = new Map(); // name -> Set of ids (for search)
  }

  // Core operations with O(1) or O(children) complexity

  /**
   * Adds a new node to the file system with automatic index updates
   * @param {Object} node - Node object with id, parent, type, name properties
   * @returns {Object} The added node
   *
   * How it works:
   * 1. Stores the node in main Map for O(1) access by ID
   * 2. Updates childrenIndex so parent can find its children in O(1)
   * 3. Updates typeIndex for fast filtering by file type
   * 4. Invalidates path cache since tree structure changed
   */
  addNode(node) {
    const { id, parent, type, name } = node;

    // Add to main storage
    this.nodes.set(id, node);

    // Update children index

    if (!this.childrenIndex.has(parent)) {
      this.childrenIndex.set(parent, new Set());
    }
    this.childrenIndex.get(parent).add(id);

    // Update type index
    if (!this.typeIndex.has(type)) {
      this.typeIndex.set(type, new Set());
    }
    this.typeIndex.get(type).add(id);

    // Invalidate path cache for this branch
    this.invalidatePathCache(id);

    return node;
  }

  /**
   * Deletes a node and all its descendants from the file system
   * @param {string} id - ID of the node to delete
   * @returns {boolean} Success status
   *
   * How it works:
   * 1. First finds ALL descendants using BFS traversal (children, grandchildren, etc.)
   * 2. Collects them in a Set to delete everything in one pass
   * 3. For each node to delete:
   *    - Removes from parent's children index
   *    - Removes from type index
   *    - Clears path cache
   *    - Deletes the node itself
   * 4. This ensures no orphaned nodes remain in the system
   *
   * Why batch deletion: Prevents partial deletes if something fails
   */
  deleteNode(id) {
    const node = this.nodes.get(id);
    if (!node) return false;

    // Collect all descendants + self
    const toDelete = this.getAllDescendants(id);
    toDelete.add(id);

    for (const nodeId of toDelete) {
      const n = this.nodes.get(nodeId);
      if (!n) continue; // <-- safety guard

      // Remove from parent's children index (including null roots)
      if (this.childrenIndex.has(n.parent)) {
        this.childrenIndex.get(n.parent).delete(nodeId);

        // Clean up empty sets
        if (this.childrenIndex.get(n.parent).size === 0) {
          this.childrenIndex.delete(n.parent);
        }
      }

      // Remove from type index
      if (this.typeIndex.has(n.type)) {
        this.typeIndex.get(n.type).delete(nodeId);
        if (this.typeIndex.get(n.type).size === 0) {
          this.typeIndex.delete(n.type);
        }
      }

      // Clear caches + remove node
      this.pathCache.delete(nodeId);
      this.nodes.delete(nodeId);

      // Also clean up any children index entry for this node itself
      this.childrenIndex.delete(nodeId);
    }

    return true;
  }

  /**
   * Moves a node to a new parent (like dragging a folder in a file explorer)
   * @param {string} nodeId - ID of node to move
   * @param {string} newParentId - ID of new parent
   * @returns {boolean} Success status
   *
   * How it works:
   * 1. CRITICAL: First checks for circular reference (can't move folder into itself)
   * 2. Updates the children index of the OLD parent (removes this node)
   * 3. Updates the node's parent pointer
   * 4. Updates the children index of the NEW parent (adds this node)
   * 5. Invalidates path cache for entire moved branch (paths changed!)
   *
   * Example: Moving /documents/work into /archive
   * - Before: /documents/work/project.txt
   * - After: /archive/work/project.txt
   * All descendant paths need recalculation
   */
  moveNode(nodeId, newParentId) {
    const node = this.nodes.get(nodeId);
    if (!node) return false;

    // Check for circular reference
    if (this.isDescendant(newParentId, nodeId)) {
      throw new Error('Cannot move a folder into its own descendant');
    }

    const oldParent = node.parent;

    // Update children index for old parent
    if (oldParent && this.childrenIndex.has(oldParent)) {
      this.childrenIndex.get(oldParent).delete(nodeId);
    }

    // Update node's parent
    node.parent = newParentId;

    // Update children index for new parent
    if (newParentId) {
      if (!this.childrenIndex.has(newParentId)) {
        this.childrenIndex.set(newParentId, new Set());
      }
      this.childrenIndex.get(newParentId).add(nodeId);
    }

    // Invalidate path cache for moved branch
    this.invalidatePathCacheBranch(nodeId);

    return true;
  }

  // Helper methods

  /**
   * Gets immediate children of a node (NOT recursive)
   * @param {string} parentId - Parent node ID
   * @returns {Array} Array of child nodes
   *
   * How it works:
   * Uses the childrenIndex for O(1) lookup instead of scanning all nodes
   * Without index: Would need to loop through ALL nodes checking parent field
   * With index: Direct Set lookup
   */
  getChildren(parentId) {
    // O(1) operation instead of O(n)
    const childIds = this.childrenIndex.get(parentId);
    console.warn('getChildren called for parentId:', parentId, 'found childIds:', this.childrenIndex);
    if (!childIds) return [];

    return Array.from(childIds).map(id => this.nodes.get(id));
  }

  /**
   * Gets ALL descendants recursively (children, grandchildren, etc.)
   * Uses Breadth-First Search (BFS) algorithm
   * @param {string} nodeId - Starting node ID
   * @returns {Set} Set of all descendant IDs
   *
   * How BFS works here:
   * 1. Starts with a queue containing just the root node
   * 2. Takes first item from queue (FIFO - First In First Out)
   * 3. Adds all its children to the queue
   * 4. Repeats until queue is empty
   *
   * Why BFS over DFS for this:
   * - Processes level by level (all children, then grandchildren)
   * - Better for finding all descendants evenly
   * - Uses less memory than recursive DFS (no call stack)
   *
   * Visual example for folder structure:
   *     A
   *    / \
   *   B   C
   *  / \   \
   * D   E   F
   *
   * BFS order: A → B → C → D → E → F (level by level)
   * Queue evolution: [A] → [B,C] → [C,D,E] → [D,E,F] → [E,F] → [F] → []
   */
  getAllDescendants(nodeId) {
    const descendants = new Set();
    const queue = [nodeId];

    while (queue.length > 0) {
      const current = queue.shift();
      const children = this.childrenIndex.get(current);

      if (children) {
        for (const childId of children) {
          descendants.add(childId);
          queue.push(childId);
        }
      }
    }

    return descendants;
  }

  /**
   * Checks if one node is a descendant of another
   * @param {string} possibleDescendantId - Node that might be a descendant
   * @param {string} ancestorId - Potential ancestor node
   * @returns {boolean} True if first node is descendant of second
   *
   * How it works:
   * Walks UP the tree from possible descendant to root
   * If it encounters the ancestor along the way, returns true
   *
   * Critical for move operations:
   * Prevents moving a parent folder into its own child (circular reference)
   * Example: Can't move /documents into /documents/archive
   */
  isDescendant(possibleDescendantId, ancestorId) {
    let current = possibleDescendantId;
    const visited = new Set(); // Prevent infinite loops

    while (current) {
      if (visited.has(current)) return false; // Circular reference
      if (current === ancestorId) return true;

      visited.add(current);
      const node = this.nodes.get(current);
      current = node?.parent;
    }

    return false;
  }

  /**
   * Gets the full path of a node as an array
   * @param {string} nodeId - Node ID
   * @returns {Array} Path array like ['documents', 'work', 'report.pdf']
   *
   * How it works:
   * 1. First checks cache for O(1) performance
   * 2. If not cached, walks up the tree collecting names
   * 3. Reverses the array (we collected bottom-up)
   * 4. Caches result for future calls
   *
   * Why caching matters:
   * - Paths are frequently requested (display, breadcrumbs)
   * - Walking up tree is O(depth) operation
   * - Cache makes repeated calls O(1)
   * - Cache invalidated only when structure changes
   */
  getPath(nodeId) {
    // Check cache first
    if (this.pathCache.has(nodeId)) {
      return this.pathCache.get(nodeId);
    }

    const path = [];
    let current = nodeId;
    const visited = new Set();

    while (current) {
      if (visited.has(current)) {
        console.error('Circular reference detected');
        break;
      }

      const node = this.nodes.get(current);
      if (!node) break;

      path.unshift({ name: node.name, id: current }); // Add to beginning
      visited.add(current);
      current = node.parent;
    }
    path.unshift({ name: '/', id: null }); // Add root at the beginning
    // Cache the result
    this.pathCache.set(nodeId, path);
    return path;
  }

  /**
   * Gets the full path as a string
   * @param {string} nodeId - Node ID
   * @param {string} separator - Path separator (default '/')
   * @returns {string} Path like '/documents/work/report.pdf'
   */
  getPathString(nodeId, separator = '/') {
    return separator + this.getPath(nodeId).join(separator);
  }

  /**
   * Invalidates cached path for a single node
   * Called when node is renamed or structure changes
   */
  invalidatePathCache(nodeId) {
    this.pathCache.delete(nodeId);
  }

  /**
   * Invalidates cached paths for entire branch
   * Called after move operations since all descendant paths change
   * @param {string} nodeId - Root of branch to invalidate
   *
   * Example: Moving /a/b to /x/y invalidates:
   * - /a/b → /x/y/b
   * - /a/b/c → /x/y/b/c
   * - /a/b/c/d → /x/y/b/c/d
   * All these cached paths are now wrong and need recalculation
   */
  invalidatePathCacheBranch(nodeId) {
    const descendants = this.getAllDescendants(nodeId);
    descendants.add(nodeId);

    for (const id of descendants) {
      this.pathCache.delete(id);
    }
  }

  // Serialization methods

  /**
   * Converts the file system to JSON for storage
   * @returns {Object} JSON-serializable object
   *
   * Important: Only serializes nodes, not indexes
   * Indexes are rebuilt on load for data integrity
   * This prevents index corruption from bad data
   */
  toJSON() {
    return {
      nodes: Object.fromEntries(this.nodes),
      // Don't serialize indexes - rebuild on load
    };
  }

  /**
   * Rebuilds file system from JSON data
   * @param {Object} data - JSON data with nodes property
   *
   * How it works:
   * 1. Clears all existing data and indexes
   * 2. Rebuilds nodes Map from JSON
   * 3. Reconstructs all indexes by scanning nodes once
   * 4. Ensures consistency even if JSON was manually edited
   */
  fromJSON(data) {
    this.nodes.clear();
    this.childrenIndex.clear();
    this.pathCache.clear();
    this.typeIndex.clear();

    // Rebuild everything from nodes
    for (const [id, node] of Object.entries(data.nodes)) {
      this.nodes.set(id, node);

      // Rebuild children index

      if (!this.childrenIndex.has(node.parent)) {
        this.childrenIndex.set(node.parent, new Set());
      }
      this.childrenIndex.get(node.parent).add(id);

      // Rebuild type index
      if (!this.typeIndex.has(node.type)) {
        this.typeIndex.set(node.type, new Set());
      }
      this.typeIndex.get(node.type).add(id);
    }
    console.warn('VFS loaded from JSON with', this.nodes, 'nodes');
  }

  // Advanced operations

  findByName(name) {
    const results = [];
    for (const [id, node] of this.nodes) {
      if (node.name === name) {
        results.push(node);
      }
    }
    return results;
  }

  findByType(type) {
    const ids = this.typeIndex.get(type);
    if (!ids) return [];
    return Array.from(ids).map(id => this.nodes.get(id));
  }

  // Batch operations for efficiency

  batchDelete(nodeIds) {
    const allToDelete = new Set();

    // Collect all nodes and their descendants
    for (const id of nodeIds) {
      allToDelete.add(id);
      const descendants = this.getAllDescendants(id);
      for (const desc of descendants) {
        allToDelete.add(desc);
      }
    }

    // Single pass deletion
    for (const id of allToDelete) {
      const node = this.nodes.get(id);
      if (!node) continue;

      if (node.parent && this.childrenIndex.has(node.parent)) {
        this.childrenIndex.get(node.parent).delete(id);
      }

      if (this.typeIndex.has(node.type)) {
        this.typeIndex.get(node.type).delete(id);
      }

      this.pathCache.delete(id);
      this.childrenIndex.delete(id);
      this.nodes.delete(id);
    }

    return allToDelete.size;
  }

  // Tree traversal utilities

  /**
   * Generator function for traversing the tree
   * @param {string} rootId - Starting node (null for all roots)
   * @param {string} strategy - 'breadth-first' or 'depth-first'
   * @yields {Object} {id, node, depth} for each visited node
   *
   * Generator functions (function*) yield values one at a time
   * Useful for: Large trees, lazy evaluation, memory efficiency
   * Usage: for (const {node} of vfs.traverse()) { ... }
   */
  *traverse(rootId = null, strategy = 'breadth-first') {
    if (strategy === 'breadth-first') {
      yield* this.bfs(rootId);
    } else {
      yield* this.dfs(rootId);
    }
  }

  /**
   * Breadth-First Search (BFS) traversal
   * Visits nodes level by level - all siblings before any children
   * @param {string} rootId - Starting node ID
   * @yields {Object} Node information for each visited node
   *
   * How BFS works:
   * 1. Uses a QUEUE (First In, First Out)
   * 2. Visits all nodes at depth 0, then depth 1, then depth 2, etc.
   * 3. Perfect for: Finding shortest path, level-order display
   *
   * Visual traversal of tree:
   *        A
   *      /   \
   *     B     C
   *    / \   / \
   *   D   E F   G
   *
   * BFS order: A → B → C → D → E → F → G
   * Visits by level: [A] then [B,C] then [D,E,F,G]
   *
   * Use cases:
   * - File explorer expanding folders level by level
   * - Finding files/folders closest to root
   * - Implementing "Select all at this level"
   * - Breadcrumb navigation
   */
  *bfs(rootId = null) {
    const queue = rootId ? [rootId] : Array.from(this.nodes.keys()).filter(id => !this.nodes.get(id).parent);

    while (queue.length > 0) {
      const id = queue.shift(); // Take from front (FIFO)
      const node = this.nodes.get(id);
      if (!node) continue;

      yield { id, node, depth: this.getDepth(id) };

      const children = this.childrenIndex.get(id);
      if (children) {
        queue.push(...children); // Add to back
      }
    }
  }

  /**
   * Depth-First Search (DFS) traversal
   * Visits as deep as possible before backtracking
   * @param {string} rootId - Starting node ID
   * @yields {Object} Node information for each visited node
   *
   * How DFS works:
   * 1. Uses a STACK (Last In, First Out)
   * 2. Goes deep into one branch before exploring siblings
   * 3. Perfect for: Tree operations, recursive algorithms
   *
   * Visual traversal of same tree:
   *        A
   *      /   \
   *     B     C
   *    / \   / \
   *   D   E F   G
   *
   * DFS order: A → C → G → F → B → E → D
   * (Note: exact order depends on how children are added to stack)
   * Goes deep first: A→C→G, then backtracks to F, then to B→E→D
   *
   * Use cases:
   * - Calculating total folder sizes (need all descendants first)
   * - Tree copying/cloning
   * - Finding all files matching criteria
   * - Implementing "Collapse all subfolders"
   *
   * DFS vs BFS memory:
   * - BFS: O(width) - stores entire level
   * - DFS: O(height) - stores path to current node
   * For wide shallow trees: DFS uses less memory
   * For deep narrow trees: BFS uses less memory
   */
  *dfs(rootId = null) {
    const stack = rootId ? [rootId] : Array.from(this.nodes.keys()).filter(id => !this.nodes.get(id).parent);

    while (stack.length > 0) {
      const id = stack.pop(); // Take from end (LIFO)
      const node = this.nodes.get(id);
      if (!node) continue;

      yield { id, node, depth: this.getDepth(id) };

      const children = this.childrenIndex.get(id);
      if (children) {
        stack.push(...children); // Add to end
      }
    }
  }

  /**
   * Calculates how deep a node is in the tree
   * @param {string} nodeId - Node to measure
   * @returns {number} Depth (0 for root, 1 for root's children, etc.)
   *
   * How it works:
   * Walks up the tree counting steps until reaching root
   * Used for: Indentation in UI, limiting recursion depth
   */
  getDepth(nodeId) {
    let depth = 0;
    let current = nodeId;

    while (current) {
      const node = this.nodes.get(current);
      if (!node || !node.parent) break;
      depth++;
      current = node.parent;
    }

    return depth;
  }

  // Statistics and debugging

  getStats() {
    return {
      totalNodes: this.nodes.size,
      totalDirectories: this.typeIndex.get('inode/directory')?.size || 0,
      totalFiles: this.nodes.size - (this.typeIndex.get('inode/directory')?.size || 0),
      indexSizes: {
        children: this.childrenIndex.size,
        pathCache: this.pathCache.size,
        types: this.typeIndex.size,
      },
    };
  }
}

export { VirtualFileSystem };
