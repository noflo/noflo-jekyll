const noflo = require('noflo');
const events = require('events');
const path = require('path');

class Jekyll extends events.EventEmitter {
  constructor(source, target) {
    super();
    this.graph = this.prepareGraph(source, target);
  }

  run(callback) {
    this.graph.baseDir = path.resolve(__dirname, '../');
    noflo.createNetwork(this.graph, (err, network) => {
      if (err) { return callback(err); }
      this.emit('network', network);

      network.on('start', (start) => {
        this.emit('start', start);
      });

      return network.on('end', (end) => {
        this.emit('end', end);
        callback(null);
      });
    });
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
