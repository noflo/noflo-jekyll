const noflo = require('noflo');
const events = require('events');
const path = require('path');

class Jekyll extends events.EventEmitter {
  constructor(source, target) {
    super();
    this.graph = this.prepareGraph(source, target);
  }

  run(callback) {
    return this.createNetwork(this.graph, (err, network) => {
      if (err) { return callback(err); }
      this.emit('network', network);

      network.on('start', start => {
        return this.emit('start', start);
      });

      return network.on('end', start => {
        this.emit('end', start);
        return callback(null);
      });
    });
  }

  createNetwork(graph, callback) {
    graph.baseDir = path.resolve(__dirname, '../');
    return noflo.createNetwork(graph, callback);
  }

  generated(file) {
    return this.emit('generated', file);
  }

  error(error) {
    return this.emit('error', error);
  }

  prepareGraph(source, target) {
    const graph = new noflo.Graph('Jekyll');

    graph.addNode('Jekyll', 'jekyll/Jekyll');
    graph.addNode('Generated', 'Callback');
    graph.addNode('Errors', 'Callback');

    graph.addEdge('Jekyll', 'generated', 'Generated', 'in');
    graph.addEdge('Jekyll', 'errors', 'Errors', 'in');

    const generated = file => this.generated(file);
    const errors = error => this.error(error);

    graph.addInitial(generated, 'Generated', 'callback');
    graph.addInitial(errors, 'Errors', 'callback');
    graph.addInitial(source, 'Jekyll', 'source');
    graph.addInitial(target, 'Jekyll', 'destination');

    return graph;
  }
}

exports.Jekyll = Jekyll;
