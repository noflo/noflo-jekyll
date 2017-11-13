const noflo = require('noflo');

exports.getComponent = function() {
  const c = new noflo.Component;
  c.inPorts.add('from',
    {datatype: 'string'});
  c.inPorts.add('to',
    {datatype: 'string'});
  c.outPorts.add('out');
  c.forwardBrackets =
    {to: ['out']};
  return c.process(function(input, output) {
    if (!input.has('from', 'to')) { return; }
    const values = input.getData('from', 'to');
    return output.sendDone({
      out: values.join('=')});
  });
};
