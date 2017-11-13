const noflo = require('noflo');

exports.getComponent = () => {
  const c = new noflo.Component();
  c.inPorts.add('from', {
    datatype: 'string',
  });
  c.inPorts.add('to', {
    datatype: 'string',
  });
  c.outPorts.add('out', {
    datatype: 'string',
  });
  c.forwardBrackets = {
    to: ['out'],
  };
  c.process((input, output) => {
    if (!input.has('from', 'to')) { return; }
    const values = input.getData('from', 'to');
    output.sendDone({
      out: values.join('='),
    });
  });
  return c;
};
